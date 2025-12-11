const JSZip = require('jszip');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// 天地图密钥 - 请替换为您自己的有效密钥
const TDT_KEY = '';

/**
 * 下载瓦片数据
 * @param {Object} options 下载选项
 * @param {number} options.minZoom 最小层级
 * @param {极速下载number} options.maxZoom 最大层级
 * @param {Object} options.bounds 地图边界 {northEast: {lat, lng}, southWest: {lat, lng}}
 * @param {string} options.baseLayerType 底图类型 ('satellite', 'vector', 'terrain')
 * @param {string} options.outputPath 输出路径
 * @param {Function} [progressCallback] 进度回调函数
 */
async function downloadTiles(options, progressCallback) {
    const { minZoom, maxZoom, bounds, baseLayerType, outputPath } = options;
    const { northEast, southWest } = bounds;

    // 创建JSZip实例
    const zip = new JSZip();

    // 计算总瓦片数
    let totalTiles = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
        const tileBounds = getTileBounds(northEast, southWest, z);
        const tilesInZoom = (tileBounds.maxX - tileBounds.minX + 1) * (tileBounds.maxY - tileBounds.minY + 1);
        totalTiles += tilesInZoom;
    }

    let downloadedTiles = 0;
    const startTime = Date.now();

    // 下载所有层级的瓦片
    for (let z = minZoom; z <= maxZoom; z++) {
        const tileBounds = getTileBounds(northEast, southWest, z);

        // 创建当前层级的文件夹
        const zoomFolder = zip.folder(`${z}`);

        for (let x = tileBounds.minX; x <= tileBounds.maxX; x++) {
            // 创建X坐标文件夹
            const xFolder = zoomFolder.folder(`${x}`);

            for (let y = tileBounds.minY; y <= tileBounds.maxY; y++) {
                // 获取瓦片URL
                const tileUrl = getTileUrl(z, x, y, baseLayerType);

                try {
                    // 下载瓦片 - 添加User-Agent和Referer头信息
                    const response = await axios({
                        url: tileUrl,
                        method: 'GET',
                        responseType: 'arraybuffer',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Referer': 'http://localhost'
                        },
                        timeout: 10000 // 10秒超时
                    });

                    // 将瓦片添加到ZIP
                    xFolder.file(`${y}.png`, response.data);

                    downloadedTiles++;

                    // 更新进度
                    if (progressCallback) {
                        const progress = Math.round((downloadedTiles / totalTiles) * 100);
                        const elapsed = (Date.now() - startTime) / 1000;
                        const remaining = Math.round((elapsed / downloadedTiles) * (totalTiles - downloadedTiles));

                        progressCallback({
                            downloaded: downloadedTiles,
                            total: totalTiles,
                            progress: progress,
                            elapsed: elapsed,
                            remaining: remaining
                        });
                    }
                } catch (error) {
                    console.error(`下载瓦片失败 (z=${z}, x=${x}, y=${y}):`, error.message);

                    // 如果出现403错误，可能是密钥无效
                    if (error.response && error.response.status === 403) {
                        console.error('错误原因: 403 Forbidden - 请检查您的天地图密钥是否有效');
                    }
                }
            }
        }
    }

    // 生成ZIP文件
    const zipContent = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
            level: 6
        }
    });

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 保存ZIP文件
    fs.writeFileSync(outputPath, zipContent);
    console.log(`下载完成! 文件已保存至: ${outputPath}`);
}

/**
 * 获取瓦片URL
 * @param {number} z 层级
 * @param {number} x X坐标
 * @param {number} y Y坐标
 * @param {string} baseLayerType 底图类型
 * @returns {string} 瓦片URL
 */
function getTileUrl(z, x, y, baseLayerType) {
    const subdomain = Math.floor(Math.random() * 8); // 随机选择子域名

    if (baseLayerType === 'satellite') {
        return `http://t${subdomain}.tianditu.gov.cn/img_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TileMatrix=${z}&TileCol=${x}&TileRow=${y}`;
    } else if (baseLayerType === 'vector') {
        return `http://t${subdomain}.tianditu.gov.cn/vec_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TileMatrix=${z}&TileCol=${x}&TileRow=${y}`;
    } else if (baseLayerType === 'terrain') {
        return `http://t${subdomain}.tianditu.gov.cn/ter_w/wmts?tk=${TDT_KEY}&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ter&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TileMatrix=${z}&TileCol=${x}&TileRow=${y}`;
    }

    throw new Error(`未知的底图类型: ${baseLayerType}`);
}

/**
 * 获取指定层级下的瓦片边界
 * @param {Object} northEast 东北角坐标 {lat, lng}
 * @param {Object} southWest 西南角坐标 {lat, lng}
 * @param {number} zoom 层级
 * @returns {Object} 瓦片边界 {minX, maxX, minY, maxY}
 */
function getTileBounds(northEast, southWest, zoom) {
    // 计算瓦片坐标
    const project = function (lat, lng) {
        // 将经纬度转换为弧度
        const latRad = lat * Math.PI / 180;

        // 计算瓦片坐标
        const n = Math.pow(2, zoom);
        const xTile = n * ((lng + 180) / 360);
        const yTile = n * (1 - (Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2;

        return {
            x: Math.floor(xTile),
            y: Math.floor(yTile)
        };
    };

    // 获取西北角和东南角的瓦片坐标
    const nw = project(northEast.lat, southWest.lng);
    const se = project(southWest.lat, northEast.lng);

    return {
        minX: Math.min(nw.x, se.x),
        maxX: Math.max(nw.x, se.x),
        minY: Math.min(nw.y, se.y),
        maxY: Math.max(nw.y, se.y)
    };
}

/**
 * 命令行界面
 */
async function runCLI() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // 获取用户输入
    const getInput = (question) => new Promise(resolve => rl.question(question, resolve));

    console.log('天地图瓦片下载工具');
    console.log('===================');

    // 获取参数
    const minZoom = parseInt(await getInput('最小层级 (1-18): '));
    const maxZoom = parseInt(await getInput('最大层级 (1-18): '));

    const northLat = parseFloat(await getInput('北边界纬度 (例如: 39.92): '));
    const eastLng = parseFloat(await getInput('东边界经度 (例如: 116.40): '));
    const southLat = parseFloat(await getInput('南边界纬度 (例如: 39.91): '));
    const westLng = parseFloat(await getInput('西边界经度 (例如: 116.39): '));

    const baseLayerType = await getInput('底图类型 (satellite/vector/terrain): ');
    const outputPath = await getInput('输出文件路径 (例如: tiles.zip): ');

    rl.close();

    // 验证输入
    if (isNaN(minZoom) || isNaN(maxZoom) || minZoom < 1 || maxZoom > 18 || minZoom > maxZoom) {
        console.error('无效的层级范围');
        return;
    }

    if (isNaN(northLat) || isNaN(eastLng) || isNaN(southLat) || isNaN(westLng)) {
        console.error('无效的边界坐标');
        return;
    }

    if (!['satellite', 'vector', 'terrain'].includes(baseLayerType)) {
        console.error('无效的底图类型');
        return;
    }

    // 设置边界
    const bounds = {
        northEast: { lat: northLat, lng: eastLng },
        southWest: { lat: southLat, lng: westLng }
    };

    // 进度回调函数
    let lastProgress = 0;
    const progressCallback = (progress) => {
        const currentProgress = Math.floor(progress.progress);

        // 只在进度变化时更新
        if (currentProgress !== lastProgress) {
            lastProgress = currentProgress;

            const elapsedMin = Math.floor(progress.elapsed / 60);
            const elapsedSec = Math.floor(progress.elapsed % 60);
            const remainingMin = Math.floor(progress.remaining / 60);
            const remainingSec = Math.floor(progress.remaining % 60);

            console.log(`进度: ${currentProgress}% | 已下载: ${progress.downloaded}/${progress.total} | 已用时间: ${elapsedMin}分${elapsedSec}秒 | 预计剩余: ${remainingMin}分${remainingSec}秒`);
        }
    };

    // 开始下载
    try {
        console.log('开始下载瓦片...');
        await downloadTiles({
            minZoom,
            maxZoom,
            bounds,
            baseLayerType,
            outputPath
        }, progressCallback);

        console.log('下载完成!');
    } catch (error) {
        console.error('下载过程中出错:', error.message);
    }
}

// 如果直接运行此文件，启动命令行界面
if (require.main === module) {
    runCLI();
}

// 导出函数供其他模块使用
module.exports = {
    downloadTiles,
    getTileBounds,
    getTileUrl
};
