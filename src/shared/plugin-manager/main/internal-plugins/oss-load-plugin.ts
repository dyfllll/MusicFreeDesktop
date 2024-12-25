import { Plugin } from "@/shared/plugin-manager/main/plugin";
import { S3, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import AppConfig from "@shared/app-config/main";
import path from "path";

export const ossPluginName = "oss";
export const ossPluginHash = "oss";

let s3Client: S3 = null;
let s3SecretId = "";
let s3SecretKey = "";
let s3Local = true;
let s3Bucket = "";
let s3Region = "us-east-1";
let s3EndpointLocal = "";
let s3EndpointServer = "";
const ossPathData = "custom";

function getOssPathKey() {
    return `${ossPathData}/`;
}

function getS3Object() {

    const secretId = AppConfig.getConfig("backup.oss.s3SecretId");
    const secretKey = AppConfig.getConfig("backup.oss.s3SecretKey");
    const bucket = AppConfig.getConfig("backup.oss.s3Bucket");
    const endpointLocal = AppConfig.getConfig("backup.oss.s3EndpointLocal");
    const endpointServer = AppConfig.getConfig("backup.oss.s3EndpointServer");
    const local = AppConfig.getConfig("backup.oss.s3Local");


    let create = false;
    create = create || s3Client == null;
    create = create || s3SecretId != secretId;
    create = create || s3SecretKey != secretKey;
    create = create || s3Bucket != bucket;
    create = create || s3EndpointLocal != endpointLocal;
    create = create || s3EndpointServer != endpointServer;
    create = create || s3Local != local;

    if (create) {
        const config = {
            region: s3Region,
            credentials: {
                accessKeyId: secretId,
                secretAccessKey: secretKey,
            },
            endpoint: local ? endpointLocal : endpointServer,
            forcePathStyle: true,
        };
        s3Client = new S3(config);
    }


    s3SecretId = secretId;
    s3SecretKey = secretKey;
    s3Bucket = bucket;
    s3EndpointLocal = endpointLocal;
    s3EndpointServer = endpointServer;
    s3Local = local;

    return s3Client;
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

function localPluginDefine(): IPlugin.IPluginInstance {

    return {
        platform: ossPluginName,
        _path: "",
        async getMediaSource(musicItem) {
            if (musicItem.platform != ossPluginName) return;
            const url = await getS3Url(musicItem.id);
            console.log(url);
            return {
                url: url,
            };
        },

        async getMusicSheetInfo(sheetItem, page) {

            try {

                const musicList: IMusic.IMusicItem[] = [];

                let nextMark: string | null = null;
                do {
                    const result = await getS3Object().listObjects({
                        Bucket: s3Bucket,
                        Prefix: sheetItem.id,
                        Marker: nextMark,
                        Delimiter: "/",
                    });

                    result.Contents.forEach(item => {

                        try {

                            if (item.Size == 0) return;

                            const ext = path.extname(item.Key).toLowerCase();

                            if (ext != ".mp3" && ext != ".wav" && ext != ".flac"
                                && ext != ".ogg" && ext != ".wma" && ext != ".aac")
                                return;


                            const filename = path.basename(item.Key, ext);
                            const strs = filename.split("-");

                            musicList.push({
                                id: item.Key,
                                artist: strs[1],
                                title: strs[0],
                                platform: ossPluginName
                            });

                        } catch { }



                    });

                    nextMark = result.NextMarker;
                } while (nextMark)


                return {
                    isEnd: true,
                    musicList: musicList,
                    albumItem: {
                        description: "",
                    },
                };

            } catch (e) {
                console.log(e);
            }
        },

        async getRecommendSheetTags() {
            return {
            }
        },


        async getRecommendSheetsByTag(tagItem) {

            try {
                const prefix = getOssPathKey();

                const result = await getS3Object().listObjects({
                    Bucket: s3Bucket,
                    Prefix: prefix,
                    Delimiter: "/",
                });

                return {
                    isEnd: true,
                    data: result.CommonPrefixes.map((item) => {
                        return {
                            title: item.Prefix.substring(prefix.length, item.Prefix.length - 1),
                            id: item.Prefix,
                            platform: ossPluginName
                        }
                    }),

                };
            } catch (e) {
                console.log(e);
            }

        },

    };
}



const ossPlugin = new Plugin(localPluginDefine, "");
ossPlugin.hash = ossPluginHash;
export default ossPlugin;
