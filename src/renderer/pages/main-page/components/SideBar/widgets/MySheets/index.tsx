import "./index.scss";
import ListItem from "../ListItem";
import { useMatch, useNavigate } from "react-router-dom";
import { Disclosure } from "@headlessui/react";
import MusicSheet, { defaultSheet } from "@/renderer/core/music-sheet";
import SvgAsset from "@/renderer/components/SvgAsset";
import { hideModal, showModal } from "@/renderer/components/Modal";
import { localPluginName } from "@/common/constant";
import { showContextMenu } from "@/renderer/components/ContextMenu";
import { useTranslation } from "react-i18next";
import {useSupportedPlugin} from "@shared/plugin-manager/renderer";
import AppConfig from "@shared/app-config/renderer";
import { toast } from "react-toastify";
import ossUtil from "@/renderer/core/ossUtil";
import BackupResume from "@/renderer/core/backup-resume";
import { dialogUtil, fsUtil } from "@shared/utils/renderer";
import * as backend from "@/renderer/core/music-sheet/backend";
import { useEffect } from "react";

export default function MySheets() {
  const sheetIdMatch = useMatch(
    `/main/musicsheet/${encodeURIComponent(localPluginName)}/:sheetId`
  );
  const currentSheetId = sheetIdMatch?.params?.sheetId;
  const musicSheets = MusicSheet.frontend.useAllSheets();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const importablePlugins = useSupportedPlugin("importMusicSheet");

  async function onCkeckClick() {
    let map = await ossUtil.getS3BackupList();

    const parts: string[] = [];
    const datas: IMusic.IMusicItem[] = [];

    const sheetDetails =
      await MusicSheet.frontend.exportAllSheetDetails();

    sheetDetails.forEach(sheet => {
      sheet.musicList?.forEach(it => {
        let item = it as IMusic.IMusicItem;
        if (item) {
          let name = ossUtil.getOssPathName(item);
          if (!map.has(name)) {
            parts.push(name);
            datas.push(item);
          }
        }
      });
    });

    if (parts.length > 0) {

      const exportFile = true;

      if (exportFile) {
        const result = await dialogUtil.showSaveDialog({
          properties: ["showOverwriteConfirmation", "createDirectory"],
          filters: [
            {
              name: "文本文件",
              extensions: ["txt"],
            },
          ],
          title: "导出结果",
        });
        if (!result.canceled && result.filePath) {
          await fsUtil.writeFile(result.filePath, parts.join('\r\n'), "utf-8");
          toast.success(t("导出成功"));
        }
      } else {
          //批量上传
      }

    } else {
      toast.success(t("已经全部备份"));
    }
  }

  async function onBackupClick() {
    try {
      const sheetDetails =
        await MusicSheet.frontend.exportAllSheetDetails();
      const backUp = JSON.stringify(
        {
          musicSheets: sheetDetails,
        },
        undefined,
        0
      );
      const hash = await ossUtil.uploadCosBackupFile(backUp);
      AppConfig.setConfig({
        "backup.oss.autoUpdateHash": hash
      });
      toast.success(t("settings.backup.backup_success"));

    } catch (e) {
      toast.error(
        t("settings.backup.backup_fail", {
          reason: e?.message,
        })
      );
    }
  }

  async function onResumeClick() {
    try {
      const { hash, data } = await ossUtil.dowloadCosBackupFile();
      await BackupResume.resumeOSS(
        data,
        AppConfig.getConfig("backup.resumeBehavior") === "overwrite"
      );
      AppConfig.setConfig({
        "backup.oss.autoUpdateHash": hash
      });
      toast.success(t("settings.backup.resume_success"));

    } catch (e) {
      toast.error(
        t("settings.backup.resume_fail", {
          reason: e?.message,
        })
      );
    }

  }

  const collator = new Intl.Collator('en');
  function onSortClick(sheetId: string, tips: string, compareFn: (a: IMusic.IMusicItem, b: IMusic.IMusicItem) => number) {
    hideModal();
    showModal("Reconfirm", {
      title: "排序",
      content: tips,
      async onConfirm() {
        hideModal();
        const sheet = await backend.getSheetItemDetail(sheetId);
        if (!sheet) {
          toast.warn("获取歌单失败");
          return;
        }
        const musicList = sheet.musicList;
        musicList.sort(compareFn);
        await MusicSheet.frontend.updateSheetMusicOrder(sheet.id, musicList);
        navigate(`/main/musicsheet/${encodeURIComponent(localPluginName)}/${encodeURIComponent(sheetId)}`);
        toast.success("排序成功");
      },
    });
  }

  useEffect(() => {
    const updateMusicList = async () => {
      try {
        const remoteHash = await ossUtil.getCosBackupFileHash();
        const localHash = AppConfig.getConfig("backup.oss.autoUpdateHash");
        if (remoteHash != localHash) {
          const { hash, data } = await ossUtil.dowloadCosBackupFile();
          await BackupResume.resumeOSS(
            data,
            AppConfig.getConfig("backup.resumeBehavior") === "overwrite"
          );
          AppConfig.setConfig({
            "backup.oss.autoUpdateHash": hash
          });
          console.log("hash:" + hash);
          toast.success("自动更新歌单成功");
        }
      } catch (error) {
        toast.error("自动更新歌单失败");
        console.log(error);
      }
    }
    if (AppConfig.getConfig("backup.oss.autoUpdate")) {
      updateMusicList();
    }
  }, []);


  return (
    <div className="side-bar-container--my-sheets">
      <div className="divider"></div>
      <Disclosure defaultOpen>
        <Disclosure.Button className="title" as="div" role="button">
          <div className="my-sheets">{t("side_bar.my_sheets")}</div>
          <div
            role="button"
            className="option-btn"
            title="导出未备份"
            onClick={(e) => {
              e.stopPropagation();
              onCkeckClick();
            }}
          >
            <SvgAsset iconName="oss-check"  size={16} ></SvgAsset>
          </div>
          <div
            role="button"
            className="option-btn"
            title="备份"
            onClick={(e) => {
              e.stopPropagation();
              showModal("Reconfirm", {
                title: "备份歌单",
                content: "是否备份歌单",
                async onConfirm() {
                  hideModal();
                  await onBackupClick();
                },
              });
            }}
          >
            <SvgAsset iconName="oss-upload"></SvgAsset>
          </div>
          <div
            role="button"
            className="option-btn"
            title="恢复"
            onClick={(e) => {
              e.stopPropagation();
              showModal("Reconfirm", {
                title: "恢复歌单",
                content: "是否恢复歌单",
                async onConfirm() {
                  hideModal();
                  await onResumeClick();
                },
              });
            }}
          >
            <SvgAsset iconName="oss-download"></SvgAsset>
          </div>
          <div
            role="button"
            className="option-btn"
            title={t("plugin.method_import_music_sheet")}
            onClick={(e) => {
              e.stopPropagation();
              showModal("ImportMusicSheet", {
                plugins: importablePlugins,
              });
            }}
          >
            <SvgAsset iconName="arrow-left-end-on-rectangle"></SvgAsset>
          </div>
          <div
            role="button"
            className="option-btn"
            title={t("side_bar.create_local_sheet")}
            onClick={(e) => {
              e.stopPropagation();
              showModal("AddNewSheet");
            }}
          >
            <SvgAsset iconName="plus"></SvgAsset>
          </div>
        </Disclosure.Button>
        <Disclosure.Panel>
          {musicSheets.map((item) => (
            <ListItem
              key={item.id}
              iconName={
                item.id === defaultSheet.id ? "heart-outline" : "musical-note"
              }
              onClick={() => {
                currentSheetId !== item.id &&
                  navigate(`/main/musicsheet/${encodeURIComponent(localPluginName)}/${encodeURIComponent(item.id)}`);
              }}
              onContextMenu={(e) => {
                // if (item.id === defaultSheet.id) {
                //   return;
                // }
                showContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  menuItems: [
                    {
                      title: "歌单排序",
                      icon: "playlist",
                      subMenu: [
                        {
                          title: "按标题排序",
                          onClick() {
                            onSortClick(item.id, "是否按标题排序", (a, b) => {
                              return collator.compare(a.title, b.title);
                            });
                          }
                        },
                        {
                          title: "按作者排序",
                          onClick() {
                            onSortClick(item.id, "是否按作者排序", (a, b) => {
                              return collator.compare(a.artist, b.artist);
                            });
                          }
                        },
                        {
                          title: "按播放次数排序",
                          onClick() {
                            if (currentSheetId != item.id) {
                              toast.warn("必须打开歌单才能次数排序");
                              return;
                            }
                            onSortClick(item.id, "是否按播放次数排序", (a, b) => {
                              const va = ossUtil.getPlayCount(a) ?? 0;
                              const vb = ossUtil.getPlayCount(b) ?? 0;
                              if (va > vb) return -1;
                              else if (va < vb) return 1;
                              else return 0;
                            });
                          }
                        }

                      ]
                    },
                    {
                      title: t("side_bar.rename_sheet"),
                      icon: "pencil-square",
                      show: item.id !== defaultSheet.id,
                      onClick() {
                        showModal("SimpleInputWithState", {
                          placeholder: t(
                            "modal.create_local_sheet_placeholder"
                          ),
                          maxLength: 30,
                          title: t("side_bar.rename_sheet"),
                          defaultValue: item.title,
                          async onOk(text) {
                            await MusicSheet.frontend.updateSheet(item.id, {
                              title: text,
                            });
                            hideModal();
                          },
                        });
                      },
                    },
                    {
                      title: t("side_bar.delete_sheet"),
                      icon: "trash",
                      show: item.id !== defaultSheet.id,
                      onClick() {
                        MusicSheet.frontend.removeSheet(item.id).then(() => {
                          if (currentSheetId === item.id) {
                            navigate(
                              `/main/musicsheet/${encodeURIComponent(localPluginName)}/${defaultSheet.id}`,
                              {
                                replace: true,
                              }
                            );
                          }
                        });
                      },
                    },
                  ],
                });
              }}
              selected={currentSheetId === item.id}
              title={
                item.id === defaultSheet.id
                  ? t("media.default_favorite_sheet_name")
                  : item.title
              }
            ></ListItem>
          ))}
        </Disclosure.Panel>
      </Disclosure>
    </div>
  );
}
