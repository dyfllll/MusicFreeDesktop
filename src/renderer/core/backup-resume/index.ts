import MusicSheet from "../music-sheet";

/**
 * 恢复
 * @param data 数据
 * @param overwrite 是否覆写歌单
 */
async function resume(data: string | Record<string, any>, overwrite?: boolean) {
  const dataObj = typeof data === "string" ? JSON.parse(data) : data;

  const currentSheets = MusicSheet.frontend.getAllSheets();
  const allSheets: IMusic.IMusicSheetItem[] = dataObj.musicSheets;

  let importedDefaultSheet;
  for (const sheet of allSheets) {
    if (overwrite && sheet.id === MusicSheet.defaultSheet.id) {
      importedDefaultSheet = sheet;
      continue;
    }
    const newSheet = await MusicSheet.frontend.addSheet(sheet.title);
    await MusicSheet.frontend.addMusicToSheet(sheet.musicList, newSheet.id);
  }
  if (overwrite) {
    for (const sheet of currentSheets) {
      if (sheet.id === MusicSheet.defaultSheet.id) {
        if (importedDefaultSheet) {
          await MusicSheet.frontend.clearSheet(MusicSheet.defaultSheet.id);
          await MusicSheet.frontend.addMusicToFavorite(
            importedDefaultSheet.musicList
          );
        }
      }
      await MusicSheet.frontend.removeSheet(sheet.id);
    }
  }
}



async function resumeOSS(data: string | Record<string, any>, overwrite?: boolean) {
  const getTitleId= (id:string)=> id=="favorite"?"我喜欢":id;
  const dataObj = typeof data === "string" ? JSON.parse(data) : data;

  const currentSheets = MusicSheet.frontend.getAllSheets();
  const allSheets: IMusic.IMusicSheetItem[] = dataObj.musicSheets;

  let localSheetMap: Map<string, IMusic.IDBMusicSheetItem> = new Map<string, IMusic.IDBMusicSheetItem>();

  currentSheets.map(it => localSheetMap.set(it.title ?? getTitleId(it.id), it));

  for (const remoteSheet of allSheets) {

    const key = remoteSheet.title ?? getTitleId(remoteSheet.id);
    if (localSheetMap.has(key)) {
      let localSheet = localSheetMap.get(key);
      let localList = localSheet.musicList;
      let remoteList = remoteSheet.musicList;
      let addList: IMusic.IMusicItem[] = [];

      let checkIndex = 0;
      for (let i = 0; i < localList.length; i++) {
        let local = localList[i];
        for (let j = checkIndex; j < remoteList.length; j++) {
          let remote = remoteList[j];
          if (remote.id == local.id) {
            let temp = remoteList[checkIndex];
            remoteList[checkIndex] = remote;
            remoteList[j] = temp;
            checkIndex++;
            break;
          }
        }
      }

      for (let i = checkIndex; i < remoteList.length; i++) {
        addList.push(remoteList[i]);
      }

      if (addList.length > 0)
        await MusicSheet.frontend.addMusicToSheet(addList, localSheet.id);

    } else {
      const newSheet = await MusicSheet.frontend.addSheet(remoteSheet.title);
      await MusicSheet.frontend.addMusicToSheet(remoteSheet.musicList, newSheet.id);
    }
  }
}

const BackupResume = {
  resume,
  resumeOSS
};
export default BackupResume;
