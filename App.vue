<template>
  <el-container class="container">
    <el-main>
      <el-card>
        <template #header>
          <div class="card-header">
            <el-row align="middle">
              <el-col :span="2">
                <img src="./src/icon.png" alt="图标" style="width: 32px; height: 32px;">
              </el-col>
              <el-col :span="22">
                <h2 style="margin: 0;">图片下载器</h2>
              </el-col>
            </el-row>
          </div>
        </template>

        <el-form :model="form" label-width="100px">
          <el-form-item label="网页地址" required>
            <el-input v-model="form.url" placeholder="请输入网页地址"></el-input>
          </el-form-item>

          <el-form-item label="保存目录" required>
            <el-input v-model="form.saveDir" placeholder="请选择保存目录" readonly>
              <template #append>
                <el-button @click="chooseDirectory">选择目录</el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item>
            <el-progress 
              :percentage="progress.percentage" 
              :status="progress.status"
              :text="progress.text">
            </el-progress>
          </el-form-item>

          <el-form-item>
            <el-button 
              type="primary" 
              @click="startProcess"
              :loading="processing">
              {{ buttonText }}
            </el-button>
            <el-button @click="openSettings">设置</el-button>
          </el-form-item>
        </el-form>

        <div class="log-container">
          <div v-for="(log, index) in logs" 
               :key="index" 
               :class="['log-entry', `log-${log.type}`]">
            [{{ log.time }}] {{ log.message }}
          </div>
        </div>
      </el-card>
    </el-main>

    <!-- 设置对话框 -->
    <el-dialog
      v-model="settingsVisible"
      title="设置"
      width="500px"
      :close-on-click-modal="false"
      :close-on-press-escape="false">
      <el-form :model="settings" label-width="120px" :rules="settingsRules" ref="settingsForm">
        <el-form-item label="User Agent" prop="userAgent">
          <el-input v-model="settings.userAgent" placeholder="请输入或使用随机 User Agent">
            <template #append>
              <el-button @click="randomUA">随机</el-button>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="图片文件名前缀" prop="fileNamePrefix">
          <el-input 
            v-model="settings.fileNamePrefix" 
            placeholder="请输入图片文件名前缀">
          </el-input>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="settings.useProxy">使用代理</el-checkbox>
        </el-form-item>

        <el-form-item 
          label="代理地址" 
          prop="proxy" 
          v-if="settings.useProxy"
          :rules="[
            { required: settings.useProxy, message: '请输入代理地址', trigger: 'blur' },
            { pattern: /^(socks5|http|https):\/\/.+/, message: '请输入正确的代理地址格式', trigger: 'blur' }
          ]">
          <el-input 
            v-model="settings.proxy" 
            placeholder="例如: socks5://127.0.0.1:7890">
          </el-input>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="cancelSettings">取消</el-button>
          <el-button type="primary" @click="saveSettings" :loading="savingSettings">
            保存
          </el-button>
        </span>
      </template>
    </el-dialog>
  </el-container>
</template>

<script>
import { ElMessage } from 'element-plus'
import path from 'path'

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
];

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const DEFAULT_FILENAME_PREFIX = 'image';

export default {
  name: 'App',
  data() {
    return {
      form: {
        url: '',
        saveDir: ''
      },
      progress: {
        percentage: 0,
        status: '',
        text: '等待开始...'
      },
      processing: false,
      buttonText: '开始解析',
      settingsVisible: false,
      savingSettings: false,
      settings: {
        userAgent: DEFAULT_USER_AGENT,
        useProxy: false,
        proxy: '',
        fileNamePrefix: DEFAULT_FILENAME_PREFIX,
        defaultSaveDir: ''
      },
      settingsBackup: null,
      settingsRules: {
        userAgent: [
          { required: true, message: '请输入或随机生成 User Agent', trigger: 'blur' }
        ],
        fileNamePrefix: [
          { required: true, message: '请输入文件名前缀', trigger: 'blur' },
          { pattern: /^[a-zA-Z0-9_\-]+$/, message: '文件名前缀只能包含字母、数字、下划线和横线', trigger: 'blur' }
        ]
      },
      logs: [],
      parsedImages: null,
      parsedFolderName: null
    }
  },
  methods: {
    addLog(message, type = 'info') {
      const time = new Date().toLocaleTimeString();
      this.logs.unshift({ time, message, type });
    },
    async chooseDirectory() {
      try {
        const result = await window.electronAPI.chooseDirectory();
        if (result) {
          this.form.saveDir = result;
          this.settings.defaultSaveDir = result;
          await window.electronAPI.saveSettings(this.settings);
          this.addLog(`已选择保存目录: ${result}`, 'success');
          ElMessage.success('已选择保存目录');
        }
      } catch (error) {
        this.addLog(`选择目录失败: ${error.message}`, 'error');
        ElMessage.error('选择目录失败');
      }
    },
    async startProcess() {
      if (!this.form.url.trim()) {
        ElMessage.warning('请输入网页地址');
        return;
      }

      try {
        new URL(this.form.url.trim());
      } catch (error) {
        ElMessage.warning('请输入有效的网页地址');
        return;
      }

      if (!this.form.saveDir) {
        ElMessage.warning('请选择保存目录');
        return;
      }

      // 根据是否已经解析过来决定下一步操作
      if (this.parsedImages && this.parsedImages.length > 0) {
        // 如果已经解析过，开始下载
        await this.startDownloading();
      } else {
        // 如果还没解析，开始解析
        await this.startParsing();
      }
    },
    async startParsing() {
      this.processing = true;
      this.buttonText = '正在解析...';
      this.progress.percentage = 0;
      this.progress.text = '开始解析...';
      this.addLog('开始解析...', 'info');

      try {
        const settings = await window.electronAPI.loadSettings() || {};
        const proxy = settings.useProxy ? settings.proxy : null;

        if (settings.useProxy && settings.proxy) {
          this.addLog('正在测试代理连接...', 'info');
          try {
            const proxyTest = await window.electronAPI.testProxy(settings.proxy);
            this.addLog(`代理测试成功，当前IP: ${proxyTest.ip}`, 'success');
          } catch (error) {
            throw new Error(`代理测试失败: ${error.message}`);
          }
        }

        const result = await window.electronAPI.startMisskonParse({
          url: this.form.url.trim(),
          proxy
        });

        console.log('解析结果:', result); // 调试日志

        if (result && result.images) {
          // 确保 images 是数组
          const images = Array.isArray(result.images) ? result.images : [result.images];
          
          const prefix = settings.fileNamePrefix || 'image';
          
          // 处理图片数据
          this.parsedImages = images.map((img, index) => {
            return {
              url: typeof img === 'string' ? img : (img.url || img.src || img),
              filename: `${prefix}${index + 1}.jpg`
            };
          }).filter(img => {
            try {
              new URL(img.url);
              return true;
            } catch (error) {
              console.log('无效的图片URL:', img.url);
              return false;
            }
          });

          console.log('处理后的图片列表:', this.parsedImages); // 调试日志

          if (this.parsedImages.length > 0) {
            const summary = `解析完成：找到 ${this.parsedImages.length} 张有效图片`;
            this.addLog(summary, 'success');
            ElMessage.success(summary);

            this.buttonText = '开始下载';
            this.parsedFolderName = result.folderName || new Date().toISOString().slice(0, 10);
            this.addLog(`准备下载到文件夹: ${this.parsedFolderName}`, 'info');
          } else {
            throw new Error('未找到有效的图片URL');
          }
        } else {
          throw new Error('解析结果无效');
        }
      } catch (error) {
        const errorMsg = `解析失败: ${error.message || error}`;
        this.addLog(errorMsg, 'error');
        ElMessage.error(errorMsg);
        this.buttonText = '开始解析';
        this.parsedImages = null;
        this.parsedFolderName = null;
      } finally {
        this.processing = false;
      }
    },
    async startDownloading() {
      this.processing = true;
      this.buttonText = '正在下载...';
      this.progress.percentage = 0;
      this.progress.text = '开始下载...';
      this.addLog('开始下载...', 'info');

      try {
        // 调试日志
        console.log('parsedImages:', this.parsedImages);
        console.log('parsedFolderName:', this.parsedFolderName);

        if (!this.parsedImages || !Array.isArray(this.parsedImages) || this.parsedImages.length === 0) {
          throw new Error('没有可下载的图片');
        }

        const settings = await window.electronAPI.loadSettings() || {};
        const proxy = settings.useProxy ? settings.proxy : null;

        // 确保每个图片对象都有必要的属性
        const validImages = this.parsedImages.map(img => ({
          url: img.url,
          filename: img.filename || new URL(img.url).pathname.split('/').pop()
        })).filter(img => img.url && img.filename);

        if (validImages.length === 0) {
          throw new Error('没有有效的图片URL');
        }

        // 调试日志
        console.log('处理后的图片列表:', validImages);

        const downloadRequest = {
          images: validImages,
          downloadPath: this.form.saveDir,
          proxy: proxy,
          folderName: this.parsedFolderName || new Date().toISOString().slice(0, 10)
        };

        // 调试日志
        console.log('下载请求:', downloadRequest);

        const downloadResult = await window.electronAPI.downloadImages(downloadRequest);

        const summary = `下载完成，成功下载 ${downloadResult} 张图片到文件夹: ${this.parsedFolderName}`;
        this.addLog(summary, 'success');
        ElMessage.success(summary);

        // 重置状态
        this.buttonText = '开始解析';
        this.parsedImages = null;
        this.parsedFolderName = null;
      } catch (error) {
        const errorMsg = `下载失败：${error.message || error}`;
        this.addLog(errorMsg, 'error');
        ElMessage.error(errorMsg);
        this.buttonText = '重试下载';
      } finally {
        this.processing = false;
      }
    },
    async openSettings() {
      try {
        const settings = await window.electronAPI.loadSettings();
        // 备份设置，用于取消时恢复，确保有默认值
        this.settingsBackup = JSON.parse(JSON.stringify({
          ...settings,
          fileNamePrefix: settings?.fileNamePrefix || DEFAULT_FILENAME_PREFIX
        }));
        this.settings = { 
          ...this.settingsBackup,
          userAgent: this.settingsBackup.userAgent || DEFAULT_USER_AGENT,
          fileNamePrefix: this.settingsBackup.fileNamePrefix || DEFAULT_FILENAME_PREFIX
        };
        this.settingsVisible = true;
      } catch (error) {
        ElMessage.error('加载设置失败');
        console.error('加载设置失败:', error);
      }
    },
    cancelSettings() {
      // 恢复备份的设置
      if (this.settingsBackup) {
        this.settings = JSON.parse(JSON.stringify(this.settingsBackup));
      }
      this.settingsVisible = false;
    },
    randomUA() {
      const randomIndex = Math.floor(Math.random() * userAgents.length);
      this.settings.userAgent = userAgents[randomIndex];
    },
    async saveSettings() {
      try {
        // 表单验证
        await this.$refs.settingsForm.validate();
        
        this.savingSettings = true;

        // 创建一个新的对象，只包含需要的数据
        const settingsToSave = {
          userAgent: this.settings.userAgent,
          useProxy: this.settings.useProxy,
          proxy: this.settings.proxy,
          fileNamePrefix: this.settings.fileNamePrefix,
          defaultSaveDir: this.settings.defaultSaveDir
        };
        
        await window.electronAPI.saveSettings(settingsToSave);
        
        // 更新备份
        this.settingsBackup = JSON.parse(JSON.stringify(settingsToSave));
        
        this.addLog('设置已保存', 'success');
        ElMessage.success('设置已保存');
        this.settingsVisible = false;
      } catch (error) {
        if (error.message) {
          this.addLog('保存设置失败: ' + error.message, 'error');
          ElMessage.error('保存设置失败: ' + error.message);
        }
      } finally {
        this.savingSettings = false;
      }
    }
  },
  mounted() {
    // 监听状态更新
    window.electronAPI.onRequestStatus((event, data) => {
      let message, type;
      if (typeof data === 'string') {
        message = data;
        type = 'info';
      } else {
        message = data.message;
        type = data.type;
      }
      this.addLog(message, type);
    });

    // 监听图片发现
    window.electronAPI.onImageFound((event, { url, index, total }) => {
      this.progress.percentage = Math.round((index / total) * 100);
      this.progress.text = `已找到 ${index}/${total} 张图片`;
      this.addLog(`找到新图片: ${url}`, 'info');
    });

    // 监听下载进度
    window.electronAPI.onProgress((event, { current, total }) => {
      this.progress.percentage = Math.round((current / total) * 100);
      this.progress.text = `下载进度: ${current}/${total} (${this.progress.percentage}%)`;
      this.addLog(`下载进度: ${current}/${total} (${this.progress.percentage}%)`, 'info');
    });
  },
  async created() {
    try {
      // 首先获取默认的图片目录
      const defaultPicturesDir = await window.electronAPI.getDefaultPicturesDir();
      
      // 加载保存的设置
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        this.settings = {
          ...settings,
          userAgent: settings.userAgent || DEFAULT_USER_AGENT,
          fileNamePrefix: settings.fileNamePrefix || DEFAULT_FILENAME_PREFIX,
          defaultSaveDir: settings.defaultSaveDir || defaultPicturesDir
        };
        // 设置表单的保存目录
        this.form.saveDir = settings.defaultSaveDir || defaultPicturesDir;
      } else {
        // 如果没有保存的设置，使用所有默认值
        this.settings = {
          userAgent: DEFAULT_USER_AGENT,
          useProxy: false,
          proxy: '',
          fileNamePrefix: DEFAULT_FILENAME_PREFIX,
          defaultSaveDir: defaultPicturesDir
        };
        // 设置表单的保存目录
        this.form.saveDir = defaultPicturesDir;
        // 保存默认设置
        await window.electronAPI.saveSettings(this.settings);
      }
      this.settingsBackup = JSON.parse(JSON.stringify(this.settings));
    } catch (error) {
      console.error('初始加载设置失败:', error);
      // 使用默认值
      const defaultPicturesDir = await window.electronAPI.getDefaultPicturesDir().catch(() => '');
      this.settings = {
        userAgent: DEFAULT_USER_AGENT,
        useProxy: false,
        proxy: '',
        fileNamePrefix: DEFAULT_FILENAME_PREFIX,
        defaultSaveDir: defaultPicturesDir
      };
      this.form.saveDir = defaultPicturesDir;
      this.settingsBackup = JSON.parse(JSON.stringify(this.settings));
    }
  }
}
</script>

<style>
body {
  margin: 0;
  padding: 16px;
  background-color: #f5f7fa;
}
.container {
  max-width: 800px;
  margin: 0 auto;
}
.log-container {
  height: 200px;
  overflow-y: auto;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 10px;
  margin-top: 20px;
  background-color: #fff;
}
.log-entry {
  margin: 5px 0;
  padding: 5px;
  border-radius: 4px;
}
.log-info { color: #606266; }
.log-error { color: #f56c6c; background-color: #fef0f0; }
.log-success { color: #67c23a; background-color: #f0f9eb; }

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style> 