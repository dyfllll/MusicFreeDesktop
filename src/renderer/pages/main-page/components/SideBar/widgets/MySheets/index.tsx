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
      await ossUtil.uploadCosBackupFile(backUp);
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
      const resumeData = await ossUtil.dowloadCosBackupFile();    
      await BackupResume.resumeOSS(
        resumeData,
        AppConfig.getConfig("backup.resumeBehavior") === "overwrite"
      );
      toast.success(t("settings.backup.resume_success"));

    } catch (e) {
      toast.error(
        t("settings.backup.resume_fail", {
          reason: e?.message,
        })
      );
    }

  }


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
                if (item.id === defaultSheet.id) {
                  return;
                }
                showContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  menuItems: [
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
