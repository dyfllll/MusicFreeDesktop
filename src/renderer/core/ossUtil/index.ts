import COS from "cos-js-sdk-v5";
import AppConfig from "@shared/app-config/renderer";
import { S3, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { localPluginName, RequestStateCode } from "@/common/constant";

let oss: COS = null;
let ossSecretId = "";
let ossSecretKey = "";
let ossBucket = "";
let ossRegion = "";


const ossPathData = "data/320k";
const ossPathBackup = "music/backup/MusicFree/PlaylistBackup.json";

export const ossPluginName = "oss";
export const ossPluginHash = "oss";

let isSetup = false;

let s3Client: S3 = null;
let s3SecretId = "";
let s3SecretKey = "";
let s3Bucket = "";
let s3Region = "us-east-1";
let s3EndpointLocal = "";
let s3EndpointRemote = "";

let netLocal = true;


async function setup() {

    let local;
    //判断是否在局域网下,否则使用tailscale地址
    try {
        await getS3Object().headObject({
            Bucket: s3Bucket,
            Key: "home.txt"
        });
        local = true;
    }
    catch (err) {
        local = false;
    }
    isSetup = true;
    AppConfig.setConfig({ "backup.oss.netLocal": local })
    console.log("use s3 url:" + (local ? s3EndpointLocal : s3EndpointRemote));
    console.log("oss setup....");

}

function isVaild() {
    return getCosObject() && getS3Object();
}


function getS3Object() {

    const secretId = AppConfig.getConfig("backup.oss.s3SecretId") ?? "";
    const secretKey = AppConfig.getConfig("backup.oss.s3SecretKey") ?? "";
    const bucket = AppConfig.getConfig("backup.oss.s3Bucket") ?? "";
    const endpointLocal = AppConfig.getConfig("backup.oss.s3EndpointLocal") ?? "";
    const endpointRemote = AppConfig.getConfig("backup.oss.s3EndpointRemote") ?? "";
    const local = isSetup ? AppConfig.getConfig("backup.oss.netLocal") : true;

    let create = false;
    create = create || s3Client == null;
    create = create || s3SecretId != secretId;
    create = create || s3SecretKey != secretKey;
    // create = create || s3Bucket != bucket;
    create = create || s3EndpointLocal != endpointLocal;
    create = create || s3EndpointRemote != endpointRemote;
    create = create || netLocal != local;

    if (create) {
        const config = {
            region: s3Region,
            credentials: {
                accessKeyId: secretId,
                secretAccessKey: secretKey,
            },
            endpoint: local ? endpointLocal : endpointRemote,
            forcePathStyle: true,
        };
        s3Client = new S3(config);
    }

    s3SecretId = secretId;
    s3SecretKey = secretKey;
    s3Bucket = bucket;
    s3EndpointLocal = endpointLocal;
    s3EndpointRemote = endpointRemote;
    netLocal = local;

    return s3Client;
}



function getS3PathKey(mediaItem: IMusic.IMusicItem) {
    if (mediaItem) {
        if (checkOssPlatform(mediaItem))
            return mediaItem.id;
        else
            return `${ossPathData}/${getOssPathName(mediaItem)}.mp3`;
    }
    return null;
}

function getOssPathName(mediaItem: IMusic.IMusicItem) {
    return `${mediaItem.title}-${mediaItem.artist}`.replace(/[/|\\?*"<>:]/g, "_");
}


async function getS3BackupList() {

    let nextMark: string | null = null;
    let resultSet: Set<string> = new Set<string>();
    do {
        const result = await getS3Object().listObjects({
            Bucket: s3Bucket,
            Prefix: `${ossPathData}/`,
            Marker: nextMark,
        });
        result.Contents.forEach(item => {
            try {
                if (item.Size == 0) return;

                const ext = ".mp3";


                if (!item.Key.endsWith(ext))
                    return;

                let strs = item.Key.split('/');
                let filename = strs[strs.length - 1];
                filename = filename.substring(0, filename.length - ext.length);
                resultSet.add(filename);
            } catch { }

        });

        nextMark = result.NextMarker;
    } while (nextMark)
    return resultSet;
}

//检测文件是否存在
async function checkS3Exist(musicItem: IMusic.IMusicItem) {
    let hasFile = false;
    let ossPath: string | null = null;

    if (musicItem) {
        ossPath = getS3PathKey(musicItem);
        hasFile = await checkS3ExistFromKey(ossPath);
    }
    return { ossExist: hasFile, ossKeyPath: ossPath }
}

async function checkS3ExistFromKey(ossPath: string) {
    let hasFile = false;
    try {
        await getS3Object().headObject({
            Bucket: s3Bucket,
            Key: ossPath,
        });
        hasFile = true;
    }
    catch (err) {
        hasFile = false;
    }
    return hasFile;
}


function checkOssPlatform(musicItem: IMusic.IMusicItem) {
    return musicItem.platform == ossPluginName;
}




async function deleteS3File(musicItem: IMusic.IMusicItem) {
    let result = false;
    let msg = "";
    try {

        const { ossExist, ossKeyPath } = await checkS3Exist(musicItem);
        if (!ossExist) {
            result = true;
            msg = "oss不存在";
            return { result: result, msg: msg }
        }

        msg = "delete s3";
        let s3Response = await getS3Object().deleteObject({
            Bucket: s3Bucket,
            Key: ossKeyPath
        });

        result = true;
        msg = "删除成功";
        return { result: result, msg: msg }

    } catch (err) {
        result = false;
        return { result: result, msg: msg }
    }

}


async function uploadS3File(buffer: string | Buffer, ossPathKey: string,
    onProgress: (loaded: number, total: number) => void, onError: (error: string) => void) {
    try {

        if (await checkS3ExistFromKey(ossPathKey))
            return true;
        const upload = new Upload({
            client: getS3Object(),
            params: {
                Bucket: s3Bucket,
                Key: ossPathKey,
                Body: buffer,
            },
        });
        upload.on("httpUploadProgress", ({ loaded, total }) => {
            onProgress(loaded, total);
        });
        await upload.done();

        return true;
    } catch (caught) {
        // if (caught instanceof Error && caught.name === "AbortError") {
        //     onError(`Multipart upload was aborted. ${caught.message}`);
        // } else {
        onError(caught);
        // }
        return false;
    }
}


async function getS3Url(keyPath: string) {
    try {
        const command = new GetObjectCommand({
            Bucket: s3Bucket,
            Key: keyPath,
        });
        const url = await getSignedUrl(getS3Object(), command);
        return url;

    } catch (err) {
        return null;
    }
}




function getCosObject() {

    const secretId = AppConfig.getConfig("backup.oss.secretId") ?? "";
    const secretKey = AppConfig.getConfig("backup.oss.secretKey") ?? "";
    const bucket = AppConfig.getConfig("backup.oss.bucket") ?? "";
    const region = AppConfig.getConfig("backup.oss.region") ?? "";



    let create = false;
    create = create || oss == null;
    create = create || ossSecretId != secretId;
    create = create || ossSecretKey != secretKey;
    // create = create || ossBucket != bucket;
    // create = create || ossRegion != region;

    if (create) {
        oss = new COS({
            SecretId: secretId,
            SecretKey: secretKey,
        });
    }

    ossSecretId = secretId;
    ossSecretKey = secretKey;
    ossBucket = bucket;
    ossRegion = region;

    return oss;
}

function getCosBackupKey() {
    return `${ossPathBackup}`;
}

async function dowloadCosBackupFile() {
    const result = await getCosObject().getObject({
        Bucket: ossBucket,
        Region: ossRegion,
        Key: getCosBackupKey(),
        DataType: "text",
    });
    return result.Body;
}

async function uploadCosBackupFile(backUp: string) {
    getCosObject().uploadFile({
        Bucket: ossBucket,
        Region: ossRegion,
        Key: getCosBackupKey(),
        Body: backUp,
    });
}

//取oss签名地址
function getCosUrl(keyPath: string) {
    const url = getCosObject()?.getObjectUrl({
        Bucket: ossBucket,
        Region: ossRegion,
        Key: keyPath,
    }, null) ?? null;
    return url;
}


let playCountStore: any = {};
let playCountStoreVaild = false;
let playCountAPIToken: string = null;
let playCountStoreSheetId = "";
let playCountRefreshCallback = () => { };

function getAPIUrl() {
    const local = AppConfig.getConfig("backup.oss.netLocal") ?? true;
    let url;
    if (local) {
        url = AppConfig.getConfig("backup.oss.serverEndpointLocal") ?? "";
    }
    else {
        url = AppConfig.getConfig("backup.oss.serverEndpointRemote") ?? "";
    }
    return url;
}

function getPlayCountKey(item: IMusic.IMusicItem) {
    return `${item.platform}-${item.id}`;
}

function getPlayCount(item: IMusic.IMusicItem) {
    const key = getPlayCountKey(item);
    return playCountStore[key];
}

function setPlayCount(item: IMusic.IMusicItem) {
    if (!playCountStoreVaild) {
        return;
    }

    const key = getPlayCountKey(item);
    playCountStore[key] = (playCountStore[key] ?? 0) + 1;

    playCountRefreshCallback();

    fetch(`${getAPIUrl()}/music/setPlayCount`, {
        method: 'POST',
        headers: {
            'Content-Type': "application/json",
            "Authorization": playCountAPIToken
        },
        body: JSON.stringify({ key: key })
    }).catch(e => { console.log(e); });

    return;
}


async function fetchPlayCountData(musicList: IMusic.IMusicItem[]) {
    try {
        if (!playCountAPIToken) {
            const tokenResult = await fetch(`${getAPIUrl()}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': "application/json",
                    "Authorization": playCountAPIToken
                },
                body: JSON.stringify({
                    username: AppConfig.getConfig("backup.oss.s3SecretId"),
                    password: AppConfig.getConfig("backup.oss.s3SecretKey")
                })
            });
            playCountAPIToken = (await tokenResult.json()).data.token;
        }

        if (!playCountAPIToken)
            throw new Error(`error token`);

        // console.log(playCountAPIToken);

        const response = await fetch(`${getAPIUrl()}/music/getPlayCountList`, {
            method: 'POST',
            headers: {
                'Content-Type': "application/json",
                'Authorization': playCountAPIToken
            },
            body: JSON.stringify(musicList.map(it => getPlayCountKey(it)))
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.data;
    } catch (error) {
        throw new Error(error);
    } finally {
    }
}


function setupPlayCountStore(musicSheet: IMusic.IMusicSheetItem, musicList: IMusic.IMusicItem[], refreshCallback: () => void) {

    if (musicSheet?.platform === localPluginName) {
        if (playCountStoreSheetId != musicSheet.id) {
            fetchPlayCountData(musicList)
                .then((data: any[]) => {
                    data?.forEach((item: any) => {
                        playCountStore[item.key] = item.count;
                    });
                    playCountStoreVaild = true;
                    refreshCallback();
                })
                .catch(e => {
                    console.log(e);
                    playCountStoreVaild = false;
                });
            playCountStoreSheetId = musicSheet.id;
        } else {
        }

    } else {
        playCountStoreVaild = false;
    }
    playCountRefreshCallback = refreshCallback;
}



export const ossUtil =
{
    setup,
    isVaild,
    getOssPathName,
    checkOssPlatform,

    getS3PathKey,
    getS3BackupList,
    checkS3Exist,
    getS3Url,
    uploadS3File,
    deleteS3File,

    dowloadCosBackupFile,
    uploadCosBackupFile,

    setupPlayCountStore,
    getPlayCount,
    setPlayCount,
}

export default ossUtil;

