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
  const getTitleId = (id: string) => id == "favorite" ? "我喜欢" : id;
  const dataObj = typeof data === "string" ? JSON.parse(data) : data;

  const currentSheets = await MusicSheet.frontend.exportAllSheetDetails();
  const allSheets: IMusic.IMusicSheetItem[] = dataObj.musicSheets;

  let localSheetMap: Map<string, IMusic.IDBMusicSheetItem> = new Map<string, IMusic.IDBMusicSheetItem>();

  currentSheets.map(it => localSheetMap.set(it.title ?? getTitleId(it.id), it));

  for (const remoteSheet of allSheets) {

    const key = remoteSheet.title ?? getTitleId(remoteSheet.id);
    if (localSheetMap.has(key)) {
      let localSheet = localSheetMap.get(key);
      let localList = localSheet.musicList;
      let remoteList = remoteSheet.musicList;
      let backupList: IMusic.IMusicItem[] = [];

      let checkIndex = 0;
      for (let i = 0; i < remoteList.length; i++) {
        let remote = remoteList[i];
        for (let j = checkIndex; j < localList.length; j++) {
          let local = localList[j];
          if (local.id == remote.id) {
            let temp = localList[checkIndex];
            localList[checkIndex] = local;
            localList[j] = temp;
            checkIndex++;
            break;
          }
        }
      }

      for (let i = checkIndex; i < localList.length; i++) {
        backupList.push(localList[i] as IMusic.IMusicItem);
      }
      
      if (backupList.length > 0) {
        const backupSheet = await MusicSheet.frontend.addSheet(`${key}_backup`);
        await MusicSheet.frontend.addMusicToSheet(backupList, backupSheet.id);
      }

      await MusicSheet.frontend.clearSheet(localSheet.id);
      await MusicSheet.frontend.addMusicToSheet(remoteSheet.musicList, localSheet.id);
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
