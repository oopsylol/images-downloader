const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const fsExtra = require('fs-extra');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);
const Store = require('electron-store');
const store = new Store();
const os = require('os');

const isDev = process.env.NODE_ENV === 'development';

// Create an Axios instance that ignores SSL certificate errors
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});

// 添加设置变量
let settings = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    concurrent: 3,
    proxy: '',
    useProxy: false
};

let mainWindow;

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false  // 禁用开发者工具
        },
        icon: path.join(__dirname, 'src/icon.png'),
        autoHideMenuBar: !isDev,
        menuBarVisible: false
    });

    // 确保菜单栏被隐藏
    win.setMenuBarVisibility(false);
    win.removeMenu();

    // 添加调试信息
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Page failed to load:', errorCode, errorDescription);
    });

    if (process.env.NODE_ENV === 'development') {
        win.loadURL('http://localhost:5173');
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'));
    }

    // 禁用右键菜单
    win.webContents.on('context-menu', (e) => {
        e.preventDefault();
    });

    return win;
}

// 添加代理测试功能
async function testProxy(proxyUrl) {
    try {
        const agent = new SocksProxyAgent(proxyUrl);
        const response = await axios.get('https://api.ipify.org?format=json', {
            proxy: false,
            httpsAgent: agent,
            timeout: 5000 // 5秒超时
        });
        return {
            success: true,
            ip: response.data.ip
        };
    } catch (error) {
        console.error('代理测试失败:', error);
        throw new Error('代理连接失败，请检查代理设置');
    }
}

// 添加代理测试的 IPC 处理
ipcMain.handle('test-proxy', async (event, proxyUrl) => {
    try {
        return await testProxy(proxyUrl);
    } catch (error) {
        throw new Error(error.message || '代理测试失败');
    }
});

// 修改文件名清理函数
function sanitizeFileName(fileName) {
    // 移除网站版权信息
    fileName = fileName
        .replace(/\s*[-–]\s*(MissKon\.com|misskon\.com|xxx\.com).*$/i, '') // 移除网站版权信息
        .replace(/[\\/:"*?<>|]/g, '') // 移除Windows不允许的字符
        .replace(/\[|\]/g, '') // 移除方括号
        .replace(/\s+/g, ' ') // 将多个空格替换为单个空格
        .trim(); // 移除首尾空格
    
    return fileName;
}

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 修改 startMisskonDownload 处理函数
ipcMain.on('startMisskonDownload', async (event, { url, proxy, saveDir, page }) => {
    try {
        // 添加页面访问延迟
        await delay(page > 1 ? Math.random() * 2000 + 1000 : 0);
        
        let agent = null;
        if (proxy) {
            if (proxy.startsWith('socks')) {
                agent = new SocksProxyAgent(proxy);
            } else {
                agent = new HttpsProxyAgent(proxy);
            }
        }

        console.log(`正在访问页面: ${url}`);
        // 获取网页内容并解析
        const response = await axiosInstance.get(url, {
            httpsAgent: agent || new https.Agent({ rejectUnauthorized: false }),
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const pageTitle = $('title').text().trim();
        console.log('访问成功，页面标题:', pageTitle);

        // 解析总页数 (仅在第一页时)
        if (page === 1) {
            // 修改页码解析逻辑
            const pageLinks = $('.page-link a.post-page-numbers');
            let totalPages = 1;
            
            if (pageLinks.length > 0) {
                // 获取最后一个页码链接的文本内容
                totalPages = parseInt(pageLinks.last().text()) || 1;
            }
            
            console.log('总页数:', totalPages);
            event.sender.send('total-pages', totalPages);
            
            // 创建下载目录（只在第一页时创建）
            const sanitizedTitle = sanitizeFileName(pageTitle);
            const downloadPath = path.join(saveDir, sanitizedTitle);
            await fsExtra.ensureDir(downloadPath);
            // 保存下载路径供后续页面使用
            event.sender.send('download-path', downloadPath);
        }

        // 获取当前页面的图片 (包括已加载的lazy图片)
        const images = $('.post-inner img.aligncenter').map((i, el) => {
            const src = $(el).attr('data-src') || $(el).attr('data-lazy-src');
            if (src) console.log(`找到图片: ${src}`);
            return src;
        }).get().filter(src => src); // 过滤掉空值

        console.log(`第${page}页找到 ${images.length} 张图片`);
        event.sender.send('page-images-count', { page, count: images.length });

        // 发送图片列表到渲染进程
        event.sender.send('page-images', { page, images });

    } catch (error) {
        console.error('下载错误:', error);
        let errorMessage = error.message;
        if (error.code === 'ENOTFOUND') {
            errorMessage = '无法访问该网站，请检查网络连接或尝试使用代理';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = '连接超时，请检查网络或代理设置';
        }
        event.sender.send('download-error', errorMessage);
    }
});

// 添加已下载图片URL记录
const downloadedUrls = new Set();

// 修改图片下载处理函数
ipcMain.handle('downloadImages', async (event, { images, downloadPath, proxy }) => {
    let agent = null;
    if (proxy) {
        if (proxy.startsWith('socks')) {
            agent = new SocksProxyAgent(proxy);
        } else {
            agent = new HttpsProxyAgent(proxy);
        }
    }

    let downloadedCount = 0;
    const uniqueImages = [...new Set(images)]; // 去重
    const totalImages = uniqueImages.length;

    for (const [index, imgUrl] of uniqueImages.entries()) {
        try {
            // 检查是否已下载
            if (downloadedUrls.has(imgUrl)) {
                console.log(`图片已下载过，跳过: ${imgUrl}`);
                continue;
            }

            console.log(`正在下载图片 ${index + 1}/${totalImages}: ${imgUrl}`);
            const imageResponse = await axiosInstance({
                method: 'get',
                url: imgUrl,
                responseType: 'stream',
                httpsAgent: agent || new https.Agent({ rejectUnauthorized: false }),
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://misskon.com/',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });

            const imagePath = path.join(downloadPath, `image_${downloadedCount + 1}${path.extname(imgUrl) || '.jpg'}`);
            const writer = fs.createWriteStream(imagePath);
            imageResponse.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 记录已下载的URL
            downloadedUrls.add(imgUrl);
            downloadedCount++;
            const progress = (downloadedCount / totalImages) * 100;
            event.sender.send('download-progress', progress);
            console.log(`图片下载成功: ${imagePath}`);
        } catch (error) {
            console.error(`下载图片失败: ${imgUrl}`, error);
        }
    }

    return downloadedCount;
});

// 修改 .ph 网站的下载处理函数
ipcMain.handle('startPhDownload', async (event, { url, proxy, saveDir }) => {
    try {
        // ... 实现 .ph 网站的下载逻辑 ...
        // 这里需要根据 .ph 网站的具体结构来实现
    } catch (error) {
        console.error('下载错误:', error);
        throw error;
    }
});

// 添加窗口控制的 IPC 处理
ipcMain.on('minimize-window', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('maximize-window', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) {
        win.unmaximize();
    } else {
        win?.maximize();
    }
});

ipcMain.on('close-window', () => {
    BrowserWindow.getFocusedWindow()?.close();
});

// 添加状态通知函数
function notifyStatus(window, message, type = 'info') {
    console.log('状态更新:', message);
    if (window && !window.isDestroyed()) {
        window.webContents.send('request-status', { message, type });
    }
}

// 添加重试函数
async function retryRequest(instance, options, window, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await instance(options);
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                const delay = (i + 1) * 2000;
                notifyStatus(window, `请求失败，${delay/1000}秒后第 ${i + 1} 次重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// 修改解析函数
async function parseMisskonPage(url, proxy, window) {
    try {
        notifyStatus(window, '正在初始化请求...');
        const allImages = new Set();
        const processedPages = new Set();
        let currentPage = url;
        let folderName = ''; // 添加文件夹名称变量

        const fetchPage = async (pageUrl) => {
            if (processedPages.has(pageUrl)) {
                return [];
            }
            
            const pageNumber = processedPages.size + 1;
            notifyStatus(window, `正在处理第 ${pageNumber} 页: ${pageUrl}`);
            processedPages.add(pageUrl);

            const options = {
                url: pageUrl,
                method: 'GET',
                timeout: 30000,
                headers: {
                    'User-Agent': settings.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                }
            };

            if (proxy) {
                options.httpsAgent = new SocksProxyAgent(proxy);
            }

            try {
                const response = await retryRequest(axios, options, window);
                const html = response.data;
                const $page = cheerio.load(html);

                // 获取文件夹名称（只在第一页获取）
                if (pageNumber === 1) {
                    const titleSpan = $page('span[itemprop="name"]').first();
                    if (titleSpan.length) {
                        folderName = titleSpan.text().trim()
                            .replace(/[<>:"/\\|?*]/g, '_')
                            .replace(/\s+/g, ' ');
                        notifyStatus(window, `找到标题: ${folderName}`);
                    }
                }

                // 只解析带有 data-src 属性的图片
                $page('.entry img[data-src]').each((index, element) => {
                    const imgUrl = $page(element).attr('data-src');
                    if (imgUrl && imgUrl.startsWith('http')) {
                        if (!allImages.has(imgUrl)) {
                            allImages.add(imgUrl);
                            notifyStatus(window, `第 ${pageNumber} 页：找到新图片 #${allImages.size}`);
                            window.webContents.send('image-found', {
                                url: imgUrl,
                                index: allImages.size,
                                total: allImages.size
                            });
                        }
                    }
                });

                // 查找分页链接
                const pageLinks = new Set();
                $page('.page-link .post-page-numbers').each((_, element) => {
                    const pageUrl = $page(element).attr('href');
                    if (pageUrl && !processedPages.has(pageUrl) && !$page(element).hasClass('current')) {
                        pageLinks.add(pageUrl);
                    }
                });

                notifyStatus(window, `第 ${pageNumber} 页处理完成，当前共找到 ${allImages.size} 张图片`);
                return Array.from(pageLinks);

            } catch (error) {
                notifyStatus(window, `处理第 ${pageNumber} 页时出错: ${error.message}`);
                throw error;
            }
        };

        try {
            notifyStatus(window, '开始解析页面...');
            let pagesToProcess = [currentPage];
            
            while (pagesToProcess.length > 0) {
                const pageUrl = pagesToProcess.shift();
                notifyStatus(window, `正在处理第 ${processedPages.size + 1} 页: ${pageUrl}`);
                const newPages = await fetchPage(pageUrl);
                if (newPages && newPages.length > 0) {
                    pagesToProcess.push(...newPages);
                    notifyStatus(window, `找到 ${newPages.length} 个新页面待处理`);
                }
            }

            if (allImages.size === 0) {
                notifyStatus(window, '未找到任何图片，请检查网页结构');
                throw new Error('未找到任何图片');
            }

            const summary = `解析完成：共处理 ${processedPages.size} 页，找到 ${allImages.size} 张不重复图片`;
            notifyStatus(window, summary);
            addLog(window, summary, 'success');

            return {
                images: Array.from(allImages),
                totalImages: allImages.size,
                totalPages: processedPages.size,
                folderName: folderName // 添加文件夹名称到返回结果
            };

        } catch (error) {
            console.error('请求错误:', error);
            
            if (error.code === 'ECONNRESET') {
                notifyStatus(window, '连接被重置，已尝试重试但仍然失败');
                throw new Error('连接不稳定，请稍后重试或使用代理');
            } else if (error.response) {
                notifyStatus(window, `服务器返回错误: ${error.response.status}`);
                throw new Error(`访问被拒绝 (${error.response.status})`);
            } else if (error.code === 'ETIMEDOUT') {
                notifyStatus(window, '请求超时，请检查网络连接');
                throw new Error('请求超时，请稍后重试');
            } else {
                notifyStatus(window, `请求错误: ${error.message}`);
                throw error;
            }
        }

    } catch (error) {
        notifyStatus(window, `解析失败: ${error.message}`);
        console.error('解析失败:', error);
        throw error;
    }
}

// 添加辅助函数
function addLog(window, message, type = 'info') {
    if (window && !window.isDestroyed()) {
        window.webContents.send('request-status', {
            message,
            type
        });
    }
}

// 修改开始解析的处理
ipcMain.handle('start-misskon-parse', async (event, { url, proxy }) => {
    try {
        mainWindow.webContents.send('request-status', { message: '正在检查配置...', type: 'info' });
        
        // 如果启用了代理，先测试代理
        if (proxy) {
            mainWindow.webContents.send('request-status', { message: '正在测试代理连接...', type: 'info' });
            const proxyTest = await testProxy(proxy);
            mainWindow.webContents.send('request-status', { 
                message: `代理测试成功，当前IP: ${proxyTest.ip}`, 
                type: 'success' 
            });
        }

        mainWindow.webContents.send('request-status', { message: '开始解析...', type: 'info' });
        const window = BrowserWindow.fromWebContents(event.sender);
        notifyStatus(window, '开始处理解析请求');
        
        const result = await parseMisskonPage(url, proxy, window);
        console.log('解析完成:', result);
        return result;
    } catch (error) {
        console.error('解析失败:', error);
        throw error;
    }
});

// 添加IPC通道定义
ipcMain.on('request-status', (event, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.webContents.send('request-status', message);
    }
});

// 加载设置
ipcMain.handle('load-settings', () => {
    try {
        return store.get('settings', {});
    } catch (error) {
        console.error('加载设置失败:', error);
        throw error;
    }
});

// 保存设置
ipcMain.handle('save-settings', async (event, newSettings) => {
    try {
        // 确保只保存需要的数据
        const settingsToSave = {
            userAgent: newSettings.userAgent || '',
            useProxy: Boolean(newSettings.useProxy),
            proxy: newSettings.proxy || '',
            defaultSaveDir: newSettings.defaultSaveDir || ''
        };
        
        store.set('settings', settingsToSave);
        settings = settingsToSave;
        return true;
    } catch (error) {
        console.error('保存设置失败:', error);
        throw new Error(error.message || '保存设置失败');
    }
});

// 随机生成 User Agent
ipcMain.handle('get-random-ua', () => {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
});

// 修改下载处理器
ipcMain.handle('download-images', async (event, { images, downloadPath, proxy, folderName }) => {
    try {
        let successCount = 0;
        const total = images.length;
        
        // 创建下载目录
        const downloadDir = path.join(downloadPath, folderName);
        await fs.mkdir(downloadDir, { recursive: true });

        for (let i = 0; i < total; i++) {
            const image = images[i];
            try {
                // 验证 URL
                if (!image.url || !image.url.startsWith('http')) {
                    throw new Error(`无效的图片URL: ${image.url}`);
                }

                // 验证文件名
                if (!image.filename) {
                    const urlObj = new URL(image.url);
                    image.filename = path.basename(urlObj.pathname);
                }

                const options = {
                    responseType: 'arraybuffer',
                    timeout: 30000, // 30秒超时
                    headers: {
                        'User-Agent': settings.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        'Referer': new URL(image.url).origin
                    }
                };

                if (proxy) {
                    const agent = new SocksProxyAgent(proxy);
                    options.httpsAgent = agent;
                    options.proxy = false;
                }

                mainWindow.webContents.send('request-status', {
                    message: `正在下载 (${i + 1}/${total}): ${image.filename}`,
                    type: 'info'
                });

                const response = await axios.get(image.url, options);
                
                if (response.status !== 200) {
                    throw new Error(`HTTP错误: ${response.status}`);
                }

                const filePath = path.join(downloadDir, image.filename);
                await fs.writeFile(filePath, response.data);
                successCount++;

                mainWindow.webContents.send('request-status', {
                    message: `成功下载: ${image.filename}`,
                    type: 'success'
                });

                // 发送进度更新
                mainWindow.webContents.send('download-progress', {
                    current: i + 1,
                    total: total
                });

            } catch (error) {
                console.error(`下载失败 ${image.url}:`, error);
                mainWindow.webContents.send('request-status', {
                    message: `下载失败: ${image.filename || image.url} - ${error.message}`,
                    type: 'error'
                });
            }
        }

        return successCount;
    } catch (error) {
        console.error('下载过程失败:', error);
        throw new Error(error.message || '下载过程失败');
    }
});

// 选择目录
ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (!result.canceled) {
        return result.filePaths[0];
    }
    return null;
});

// 添加获取默认图片目录的处理
ipcMain.handle('get-default-pictures-dir', () => {
    if (process.platform === 'win32') {
        // Windows
        return path.join(os.homedir(), 'Pictures');
    } else if (process.platform === 'darwin') {
        // macOS
        return path.join(os.homedir(), 'Pictures');
    } else {
        // Linux 和其他系统
        return path.join(os.homedir(), 'Pictures');
    }
});

app.whenReady().then(() => {
    createWindow();

    // 在生产环境中禁用开发者工具
    if (!isDev) {
        app.on('browser-window-created', (event, win) => {
            win.webContents.on('before-input-event', (event, input) => {
                if ((input.control || input.meta) && input.key.toLowerCase() === 'i') {
                    event.preventDefault();
                }
            });
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
