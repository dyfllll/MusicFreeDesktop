import {
  getMediaPrimaryKey,
  getQualityOrder,
  isSameMedia,
  setInternalData,
  getInternalData
} from "@/common/media-util";
import * as Comlink from "comlink";
import { DownloadState, localPluginName } from "@/common/constant";
import PQueue from "p-queue";
import {
  addDownloadedMusicToList,
  isDownloaded,
  removeDownloadedMusic,
  setupDownloadedMusicList,
  useDownloaded,
  useDownloadedMusicList,
} from "./downloaded-sheet";
import { getGlobalContext } from "@/shared/global-context/renderer";
import Store from "@/common/store";
import { useEffect, useState } from "react";
import { DownloadEvts, ee } from "./ee";
import AppConfig from "@shared/app-config/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import { fsUtil } from "@shared/utils/renderer";
import ossUtil from "@/renderer/core/ossUtil";
import { toast } from "react-toastify";
import MusicSheet from "@/renderer/core/music-sheet";


export interface IDownloadStatus {
  state: DownloadState;
  downloaded?: number;
  total?: number;
  msg?: string;
}

const downloadingMusicStore = new Store<Array<IMusic.IMusicItem>>([]);
const downloadingProgress = new Map<string, IDownloadStatus>();

type ProxyMarkedFunction<T extends (...args: any) => void> = T &
  Comlink.ProxyMarked;

type IOnStateChangeFunc = (data: IDownloadStatus) => void;

interface IDownloaderWorker {
  downloadFile: (
    mediaSource: IMusic.IMusicSource,
    filePath: string,
    onStateChange: ProxyMarkedFunction<IOnStateChangeFunc>
  ) => Promise<void>;
}

let downloaderWorker: IDownloaderWorker;

async function setupDownloader() {
  setupDownloaderWorker();
  setupDownloadedMusicList();
}

function setupDownloaderWorker() {
  // 初始化worker
  const downloaderWorkerPath = getGlobalContext().workersPath.downloader;
  if (downloaderWorkerPath) {
    const worker = new Worker(downloaderWorkerPath);
    downloaderWorker = Comlink.wrap(worker);
  }
  setDownloadingConcurrency(AppConfig.getConfig("download.concurrency"));
}

const concurrencyLimit = 20;
const downloadingQueue = new PQueue({
  concurrency: 5,
});

function setDownloadingConcurrency(concurrency: number) {
  if (isNaN(concurrency)) {
    return;
  }
  downloadingQueue.concurrency = Math.min(
    concurrency < 1 ? 1 : concurrency,
    concurrencyLimit
  );
}

function uploadOssLocalFile(filePath: string, ossPathKey: string, onStateChange: IOnStateChangeFunc) {
  fsUtil.readFile(filePath).then(buffer => {
    if (buffer.length == 0) {
      console.log("ERROR buffer.length==0");
      onStateChange({
        state: DownloadState.ERROR,
        msg: "ERROR buffer.length==0",
      });
      return;
    }

    let state = DownloadState.DOWNLOADING;
    ossUtil.uploadS3File(buffer, ossPathKey,
      (loaded, total) => {
        if (state !== DownloadState.DOWNLOADING) {
          return;
        }
        state = DownloadState.DOWNLOADING;
        const size = loaded;
        const totalSize = total;
        console.log(`oss upload ${state}`, size, totalSize);
        onStateChange({
          state,
          downloaded: size,
          total: totalSize,
        });
      }, (err) => {
        console.log(err, "ERROR");
        onStateChange({
          state: DownloadState.ERROR,
          msg: err,
        });
        // toast.error("上传oss失败");
      }).then((result) => {
        state = DownloadState.DONE;
        onStateChange({
          state,
        });      
        console.log("上传oss成功:" + result);
        // toast.success("上传oss成功");
      });
  }).catch(e => {
    console.log(e, "ERROR");
    onStateChange({
      state: DownloadState.ERROR,
      msg: e?.message,
    });
    // toast.error("上传oss失败");
  });
}

function ChangeStateData(data: IDownloadStatus, offset = 0, scale = 1): IDownloadStatus {
  return {
    state: data.state,
    downloaded: data.downloaded ? data.downloaded * scale + offset : data.downloaded,
    total: data.total,
    msg: data.msg
  };
}


async function autoLinkAllSheet() {
  const sheets = await MusicSheet.frontend.exportAllSheetDetails();
  const mediaQuality = AppConfig.getConfig("download.defaultQuality");
  let number = 0;
  let total = 0;
  for (const sheet of sheets) {
    for (const it of sheet.musicList) {
      const item = it as IMusic.IMusicItem;
      if (!item) continue;
      const fileName = `${item.title}-${item.artist}`.replace(/[/|\\?*"<>:]/g, "_");
      let ext = "mp3";
      const downloadBasePath =
        AppConfig.getConfig("download.path") ?? getGlobalContext().appPath.downloads;
      const downloadPath = window.path.resolve(
        downloadBasePath,
        `./${fileName}.${ext}`
      );
      if (await Downloader.linkLocalFile(item, mediaQuality, downloadPath)) {
        number++;
      }
      total++;
    }
  }
  toast.success(`成功关联${number}/${number}`);
}

async function autoUnLinkAllSheet() {
  const sheets = await MusicSheet.frontend.getAllSheets();
  for (const sheet of sheets) {
    await removeDownloadedMusic(sheet.musicList.map(it=> it as IMusic.IMusicItem), false);
  }
  toast.success(`成功清理关联`);
}


async function linkLocalFile(musicItem: IMusic.IMusicItem, mediaQuality: IMusic.IQualityKey, filePath: string) {
  if (await fsUtil.isFile(filePath)) {
    addDownloadedMusicToList(
      setInternalData<IMusic.IMusicItemInternalData>(
        musicItem as any,
        "downloadData",
        {
          path: filePath,
          quality: mediaQuality,
        },
        true
      ) as IMusic.IMusicItem
    );
    return true;
  }
  else {
    return false;
  }
}


async function startOssUpload(musicItem: IMusic.IMusicItem,
  mediaSource: IPlugin.IMediaSourceResult, mediaQuality: IMusic.IQualityKey, upload = true) {

  if (!ossUtil.isVaild())
    return;


  if (!downloaderWorker) {
    setupDownloaderWorker();
  }

  const ossPathKey = ossUtil.getS3PathKey(musicItem);

  const downloadedData = getInternalData<IMusic.IMusicItemInternalData>(
    musicItem,
    "downloadData"
  );

  let isFile = false;
  let localPath = "";

  if (downloadedData) {
    const { quality, path: _path } = downloadedData;
    if (await fsUtil.isFile(_path)) {
      isFile = true;
      localPath = _path;
    }
  } else if (musicItem.platform == localPluginName && "$$localPath" in musicItem) { //本地文件类型
    if (await fsUtil.isFile(musicItem.$$localPath)) {
      isFile = true;
      localPath = musicItem.$$localPath;
    }
  }

  if (isFile) {
    if (upload) {
      const callback = () => {
        const it = musicItem;
        const pk = getMediaPrimaryKey(it);
        downloadingProgress.set(pk, {
          state: DownloadState.WAITING,
        });

        return async () => {
          if (!downloadingProgress.has(pk)) {
            return;
          }
          downloadingProgress.get(pk).state = DownloadState.DOWNLOADING;
          await new Promise<void>((resolve) => {
            uploadOssLocalFile(localPath, ossPathKey, (stateData) => {
              downloadingProgress.set(pk, stateData);
              ee.emit(DownloadEvts.DownloadStatusUpdated, it, stateData);
              if (stateData.state === DownloadState.DONE) {
                downloadingProgress.delete(pk);
                toast.success("上传成功");
                resolve();
              } else if (stateData.state === DownloadState.ERROR) {
                downloadingProgress.delete(pk);
                toast.error("上传失败");
                resolve();
              }
            });
          });
        };
      };
      downloadingQueue.add(callback());
    }
  }
  else {
    const _musicItems = [musicItem];
    const callbacks = _musicItems.map((it) => {
      const pk = getMediaPrimaryKey(it);
      downloadingProgress.set(pk, {
        state: DownloadState.WAITING,
      });

      return async () => {
        // Not on waiting list
        if (!downloadingProgress.has(pk)) {
          return;
        }

        downloadingProgress.get(pk).state = DownloadState.DOWNLOADING;

        await new Promise<void>((resolve) => {

          const fileName = `${it.title}-${it.artist}`.replace(/[/|\\?*"<>:]/g, "_");
          let ext = mediaSource.url.match(/.*\/.+\.([^./?#]+)/)?.[1] ?? "mp3";
          ext = ext.split('&')[0];
          const downloadBasePath =
            AppConfig.getConfig("download.path") ??
            getGlobalContext().appPath.downloads;
          const downloadPath = window.path.resolve(
            downloadBasePath,
            `./${fileName}.${ext}`
          );
          downloadMusicImplWithSource(it, downloadPath, mediaSource, mediaQuality, (stateData) => {
            downloadingProgress.set(pk, stateData);
            ee.emit(DownloadEvts.DownloadStatusUpdated, it, ChangeStateData(stateData, 0, upload ? 0.5 : 1.0));
            if (stateData.state === DownloadState.DONE) {
              downloadingMusicStore.setValue((prev) =>
                prev.filter((di) => !isSameMedia(it, di))
              );
              if (!upload) {
                downloadingProgress.delete(pk);
                toast.success("下载成功");
                resolve();
              } else {
                uploadOssLocalFile(downloadPath, ossPathKey, (stateData) => {
                  downloadingProgress.set(pk, stateData);
                  ee.emit(DownloadEvts.DownloadStatusUpdated, it, ChangeStateData(stateData, 0.5, 0.5));
                  if (stateData.state === DownloadState.DONE) {
                    downloadingProgress.delete(pk);
                    toast.success("下载并上传成功");
                    resolve();
                  } else if (stateData.state === DownloadState.ERROR) {
                    toast.error("下载成功但上传失败");
                    resolve();
                  }
                });
              }
            } else if (stateData.state === DownloadState.ERROR) {
              toast.error("下载失败,download:"+stateData.downloaded);
              resolve();
            }
          });
        });
      };
    });

    downloadingMusicStore.setValue((prev) => [...prev, ..._musicItems]);
    downloadingQueue.addAll(callbacks);
  }


}

async function downloadMusicImplWithSource(
  musicItem: IMusic.IMusicItem,
  downloadPath: string,
  mediaSource: IPlugin.IMediaSourceResult, mediaQuality: IMusic.IQualityKey,
  onStateChange: IOnStateChangeFunc
) {
  try {
    if (mediaSource?.url) {
      downloaderWorker.downloadFile(
        mediaSource,
        downloadPath,
        Comlink.proxy((dataState) => {
          onStateChange(dataState);
          if (dataState.state === DownloadState.DONE) {
            addDownloadedMusicToList(
              setInternalData<IMusic.IMusicItemInternalData>(
                musicItem as any,
                "downloadData",
                {
                  path: downloadPath,
                  quality: mediaQuality,
                },
                true
              ) as IMusic.IMusicItem
            );
          }
        })
      );
    } else {
      throw new Error("Invalid Source");
    }
  } catch (e) {
    console.log(e, "ERROR");
    onStateChange({
      state: DownloadState.ERROR,
      msg: e?.message,
    });
  }
}



async function startDownload(
  musicItems: IMusic.IMusicItem | IMusic.IMusicItem[]
) {
  if (!downloaderWorker) {
    setupDownloaderWorker();
  }

  const _musicItems = Array.isArray(musicItems) ? musicItems : [musicItems];
  // 过滤掉已下载的、本地音乐、任务中的音乐
  const _validMusicItems = _musicItems.filter(
    (it) => !isDownloaded(it) && it.platform !== localPluginName
  );

  const downloadCallbacks = _validMusicItems.map((it) => {
    const pk = getMediaPrimaryKey(it);
    downloadingProgress.set(pk, {
      state: DownloadState.WAITING,
    });

    return async () => {
      // Not on waiting list
      if (!downloadingProgress.has(pk)) {
        return;
      }

      downloadingProgress.get(pk).state = DownloadState.DOWNLOADING;
      const fileName = `${it.title}-${it.artist}`.replace(/[/|\\?*"<>:]/g, "_");
      await new Promise<void>((resolve) => {
        downloadMusicImpl(it, fileName, (stateData) => {
          downloadingProgress.set(pk, stateData);
          ee.emit(DownloadEvts.DownloadStatusUpdated, it, stateData);
          if (stateData.state === DownloadState.DONE) {
            downloadingMusicStore.setValue((prev) =>
              prev.filter((di) => !isSameMedia(it, di))
            );
            downloadingProgress.delete(pk);
            resolve();
          } else if (stateData.state === DownloadState.ERROR) {
            resolve();
          }
        });
      });
    };
  });

  downloadingMusicStore.setValue((prev) => [...prev, ..._validMusicItems]);
  downloadingQueue.addAll(downloadCallbacks);
}

async function downloadMusicImpl(
  musicItem: IMusic.IMusicItem,
  fileName: string,
  onStateChange: IOnStateChangeFunc
) {
  const [defaultQuality, whenQualityMissing] = [
    AppConfig.getConfig("download.defaultQuality"),
    AppConfig.getConfig("download.whenQualityMissing"),
  ];
  const qualityOrder = getQualityOrder(defaultQuality, whenQualityMissing);
  let mediaSource: IPlugin.IMediaSourceResult | null = null;
  let realQuality: IMusic.IQualityKey = qualityOrder[0];
  for (const quality of qualityOrder) {
    try {
      mediaSource = await PluginManager.callPluginDelegateMethod(
        musicItem,
        "getMediaSource",
        musicItem,
        quality
      );
      if (!mediaSource?.url) {
        continue;
      }
      realQuality = quality;
      break;
    } catch {}
  }

  try {
    if (mediaSource?.url) {
      const ext = mediaSource.url.match(/.*\/.+\.([^./?#]+)/)?.[1] ?? "mp3";
      const downloadBasePath =
        AppConfig.getConfig("download.path") ??
        getGlobalContext().appPath.downloads;
      const downloadPath = window.path.resolve(
        downloadBasePath,
        `./${fileName}.${ext}`
      );
      downloaderWorker.downloadFile(
        mediaSource,
        downloadPath,
        Comlink.proxy((dataState) => {
          onStateChange(dataState);
          if (dataState.state === DownloadState.DONE) {
            addDownloadedMusicToList(
              setInternalData<IMusic.IMusicItemInternalData>(
                musicItem as any,
                "downloadData",
                {
                  path: downloadPath,
                  quality: realQuality,
                },
                true
              ) as IMusic.IMusicItem
            );
          }
        })
      );
    } else {
      throw new Error("Invalid Source");
    }
  } catch (e) {
    console.log(e, "ERROR");
    onStateChange({
      state: DownloadState.ERROR,
      msg: e?.message,
    });
  }
}

function useDownloadStatus(musicItem: IMusic.IMusicItem) {
  const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus | null>(
    null
  );

  useEffect(() => {
    setDownloadStatus(
      downloadingProgress.get(getMediaPrimaryKey(musicItem)) || null
    );

    const updateFn = (mi: IMusic.IMusicItem, stateData: IDownloadStatus) => {
      if (isSameMedia(mi, musicItem)) {
        setDownloadStatus(stateData);
      }
    };

    ee.on(DownloadEvts.DownloadStatusUpdated, updateFn);

    return () => {
      ee.off(DownloadEvts.DownloadStatusUpdated, updateFn);
    };
  }, [musicItem]);

  return downloadStatus;
}

// 下载状态
function useDownloadState(musicItem: IMusic.IMusicItem) {
  const musicStatus = useDownloadStatus(musicItem);
  const downloaded = useDownloaded(musicItem);

  return (
    musicStatus?.state || (downloaded ? DownloadState.DONE : DownloadState.NONE)
  );
}

const Downloader = {
  setupDownloader,
  startDownload,
  useDownloadStatus,
  useDownloadingMusicList: downloadingMusicStore.useValue,
  useDownloaded,
  isDownloaded,
  useDownloadedMusicList,
  removeDownloadedMusic,
  setDownloadingConcurrency,
  useDownloadState,
  startOssUpload,
  linkLocalFile,
  autoLinkAllSheet,
  autoUnLinkAllSheet,
};
export default Downloader;
