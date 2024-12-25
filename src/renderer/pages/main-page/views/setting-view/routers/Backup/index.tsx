import "./index.scss";
import MusicSheet from "@/renderer/core/music-sheet";
import {toast} from "react-toastify";
import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import InputSettingItem from "../../components/InputSettingItem";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import {AuthType, createClient} from "webdav";
import BackupResume from "@/renderer/core/backup-resume";
import {useTranslation} from "react-i18next";
import AppConfig from "@shared/app-config/renderer";
import {dialogUtil, fsUtil} from "@shared/utils/renderer";
import Downloader from "@/renderer/core/downloader";


export default function Backup() {
    const {t} = useTranslation();


    async function onBackupClick() {
        const url = AppConfig.getConfig("backup.webdav.url");
        const username = AppConfig.getConfig("backup.webdav.username");
        const password = AppConfig.getConfig("backup.webdav.password");

        try {
            if (
                url && username && password
            ) {
                const client = createClient(url, {
                    authType: AuthType.Password,
                    username: username,
                    password: password,
                });
                const sheetDetails =
                    await MusicSheet.frontend.exportAllSheetDetails();
                const backUp = JSON.stringify(
                    {
                        musicSheets: sheetDetails,
                    },
                    undefined,
                    0
                );
                if (!(await client.exists("/MusicFree"))) {
                    await client.createDirectory("/MusicFree");
                }
                // 临时文件
                await client.putFileContents(
                    "/MusicFree/MusicFreeBackup.json",
                    backUp,
                    {
                        overwrite: true,
                    }
                );
                toast.success(t("settings.backup.backup_success"));
            } else {
                toast.error(t("settings.backup.webdav_data_not_complete"));
            }
        } catch (e) {
            toast.error(
                t("settings.backup.backup_fail", {
                    reason: e?.message,
                })
            );
        }
    }

    async function onResumeClick() {
        const url = AppConfig.getConfig("backup.webdav.url");
        const username = AppConfig.getConfig("backup.webdav.username");
        const password = AppConfig.getConfig("backup.webdav.password");
        try {
            if (
                url &&
                username &&
                password
            ) {
                const client = createClient(url, {
                    authType: AuthType.Password,
                    username: username,
                    password: password,
                });

                if (!(await client.exists("/MusicFree/MusicFreeBackup.json"))) {
                    throw new Error(
                        t("settings.backup.webdav_backup_file_not_exist")
                    );
                }
                const resumeData = await client.getFileContents(
                    "/MusicFree/MusicFreeBackup.json",
                    {
                        format: "text",
                    }
                );
                await BackupResume.resume(
                    resumeData,
                    AppConfig.getConfig("backup.resumeBehavior") === "overwrite"
                );
                toast.success(t("settings.backup.resume_success"));
            } else {
                toast.error(t("settings.backup.webdav_data_not_complete"));
            }
        } catch (e) {
            toast.error(
                t("settings.backup.resume_fail", {
                    reason: e?.message,
                })
            );
        }

    }

    return (
        <div className="setting-view--backup-container">
            <RadioGroupSettingItem
                keyPath="backup.resumeBehavior"
                options={[
                    "append",
                    "overwrite"
                ]}
                renderItem={(item) => t("settings.backup.resume_mode_" + item)}
            ></RadioGroupSettingItem>
            <div className={"label-container"}>
                {t("settings.backup.backup_by_file")}
            </div>
            <div className="setting-row backup-row">
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={async () => {
                        const result = await dialogUtil.showSaveDialog({
                            properties: ["showOverwriteConfirmation", "createDirectory"],
                            filters: [
                                {
                                    name: t("settings.backup.musicfree_backup_file"),
                                    extensions: ["json", "txt"],
                                },
                            ],
                            title: t("settings.backup.backup_to"),
                        });
                        if (!result.canceled && result.filePath) {
                            const sheetDetails =
                                await MusicSheet.frontend.exportAllSheetDetails();
                            const backUp = JSON.stringify({
                                musicSheets: sheetDetails,
                            });
                            await fsUtil.writeFile(result.filePath, backUp, "utf-8");
                            toast.success(t("settings.backup.backup_success"));
                        }
                    }}
                >
                    {t("settings.backup.backup_music_sheet")}
                </div>
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={async () => {
                        const result = await dialogUtil.showOpenDialog({
                            properties: ["openFile"],
                            filters: [
                                {
                                    name: t("settings.backup.musicfree_backup_file"),
                                    extensions: ["json", "txt"],
                                },
                            ],
                            title: t("common.open"),
                        });
                        if (!result.canceled && result.filePaths) {
                            try {
                                const rawSheets = (await fsUtil.readFile(
                                    result.filePaths[0],
                                    "utf-8"
                                )) as string;

                                await BackupResume.resume(
                                    rawSheets,
                                    AppConfig.getConfig("backup.resumeBehavior") === "overwrite"
                                );

                                toast.success(t("backup.backup_success"));
                            } catch (e) {
                                toast.error(
                                    t("backup.backup_fail", {
                                        reason: e?.message,
                                    })
                                );
                            }
                        }
                    }}
                >
                    {t("settings.backup.resume_music_sheet")}
                </div>
            </div>
            <div className={"label-container setting-row"}>
                {t("settings.backup.backup_by_webdav")}
            </div>
            <div className="webdav-backup-container">
                <InputSettingItem
                    width="100%"
                    label={t("settings.backup.webdav_server_url")}
                    trim
                    keyPath="backup.webdav.url"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label={t("settings.backup.username")}
                    trim
                    keyPath="backup.webdav.username"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label={t("settings.backup.password")}
                    type="password"
                    trim
                    keyPath="backup.webdav.password"
                ></InputSettingItem>
            </div>
            <div className="setting-row backup-row">
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={onBackupClick}
                >
                    {t("settings.backup.backup_music_sheet")}
                </div>
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={onResumeClick}
                >
                    {t("settings.backup.resume_music_sheet")}
                </div>
            </div>
            <div className={"label-container setting-row"}>
                OSS
            </div>
            <div className="webdav-backup-container">
                <InputSettingItem
                    width="100%"
                    label="secretId"
                    trim
                    keyPath="backup.oss.secretId"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label="secretKey"
                    type="password"
                    trim
                    keyPath="backup.oss.secretKey"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label="bucket"
                    trim
                    keyPath="backup.oss.bucket"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label="region"
                    trim
                    keyPath="backup.oss.region"
                ></InputSettingItem>
        
            </div>
            <div className="setting-view--backup-container">
                <CheckBoxSettingItem
                    label="开启自动上传"
                    keyPath="backup.oss.enable"
                ></CheckBoxSettingItem>
                <CheckBoxSettingItem
                    label="播放时下载"
                    keyPath="backup.oss.playDownload"
                ></CheckBoxSettingItem>
                <CheckBoxSettingItem
                    label="优先使用备份"
                    keyPath="backup.oss.rank"
                ></CheckBoxSettingItem>
            </div>
            <div className="setting-row backup-row">
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={async ()=>{await Downloader.autoLinkAllSheet();}}
                >
                    关联本地
                </div>
                <div
                    role="button"
                    data-type="normalButton"
                    onClick={async ()=>{await Downloader.autoUnLinkAllSheet();}}
                >
                    清理关联
                </div>
            </div>
            <div className={"label-container setting-row"}>
                S3
            </div>
            <div className="webdav-backup-container">
                <InputSettingItem
                    width="100%"
                    label="secretId"
                    trim
                    keyPath="backup.oss.s3SecretId"
                ></InputSettingItem>
                <InputSettingItem
                    width="100%"
                    label="secretKey"
                    type="password"
                    trim
                    keyPath="backup.oss.s3SecretKey"
                ></InputSettingItem>
                 <InputSettingItem
                    width="100%"
                    label="bucket"
                    trim
                    keyPath="backup.oss.s3Bucket"
                ></InputSettingItem>
                 <InputSettingItem
                    width="100%"
                    label="localEndpoint"
                    trim
                    keyPath="backup.oss.s3EndpointLocal"
                ></InputSettingItem>
                 <InputSettingItem
                    width="100%"
                    label="serverEndpoint"
                    trim
                    keyPath="backup.oss.s3EndpointServer"
                ></InputSettingItem>
            </div>
            <div className="setting-view--backup-container">
                <CheckBoxSettingItem
                    label="local模式"
                    keyPath="backup.oss.s3Local"
                ></CheckBoxSettingItem>
            </div>

        </div>
    );
}
