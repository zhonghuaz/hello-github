// pages/index/index.js
const app = getApp();

Page({
  data: {
    // 用户输入
    salary: '',           // 月薪
    startTime: '09:00',   // 上班时间
    endTime: '18:00',     // 下班时间

    // 计算结果
    perSecondIncome: 0,   // 每秒收入
    perSecondDisplay: '0.0000', // 每秒收入展示
    totalEarned: 0,       // 累计已赚金额
    displayAmount: '0.00', // 展示金额

    // 状态
    isRunning: false,     // 是否正在计时
    canStart: false,      // 是否可以开始
    notWorkTime: false,   // 是否非工作时间
    soundEnabled: true,   // 音效开关
    showCanvas: false,    // 是否显示Canvas
  },

  // 内部变量（不放在 data 中，避免不必要的 setData）
  _timer: null,
  _lastTriggerMultiple: 0,  // 最近一次触发的10元整数倍
  _audioContext: null,
  _canvasCtx: null,
  _canvasWidth: 0,
  _canvasHeight: 0,
  _coins: [],               // 金币动画数组
  _animFrameId: null,
  _lastTickTime: 0,         // 上次计时时间戳
  _canvas: null,

  onLoad() {
    this._initAudio();
    // 从存储中读取用户设置
    this._loadSettings();
    // 自动计算当前已赚金额
    this._autoStartIfInWorkHours();
  },

  onReady() {
    this._initCanvas();
  },

  onShow() {
    // 从后台回到前台，补算金额
    if (this.data.isRunning && this._lastTickTime > 0) {
      const now = Date.now();
      const elapsed = (now - this._lastTickTime) / 1000; // 秒
      if (elapsed > 0 && elapsed < 86400) { // 合理范围内补算
        const compensation = elapsed * this.data.perSecondIncome;
        const newTotal = this.data.totalEarned + compensation;
        this._lastTickTime = now;
        this.setData({
          totalEarned: newTotal,
          displayAmount: newTotal.toFixed(2)
        });
        this._checkTrigger(newTotal);
      }
      // 重新启动定时器
      this._startInterval();
    }
  },

  onHide() {
    // 进入后台，暂停定时器但记录时间
    if (this.data.isRunning) {
      this._lastTickTime = Date.now();
      this._clearInterval();
    }
  },

  onUnload() {
    this._clearInterval();
    this._stopCoinAnimation();
    if (this._audioContext) {
      this._audioContext.destroy();
    }
  },

  // ==================== 音频初始化 ====================
  _initAudio() {
    this._audioContext = wx.createInnerAudioContext();
    this._audioContext.src = '/assets/coin.wav';
    this._audioContext.volume = 0.6;
  },

  // ==================== Canvas 初始化 ====================
  _initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#coinCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getWindowInfo().pixelRatio;
          
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          this._canvas = canvas;
          this._canvasCtx = ctx;
          this._canvasWidth = res[0].width;
          this._canvasHeight = res[0].height;
        }
      });
  },

  // ==================== 自动开始计算 ====================
  _autoStartIfInWorkHours() {
    const { salary, startTime, endTime } = this.data;
    const salaryNum = parseFloat(salary);

    // 如果没有设置薪资，不自动开始
    if (!salaryNum || salaryNum <= 0 || !startTime || !endTime) {
      return;
    }

    // 计算每秒收入
    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
    const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
    const workSeconds = (endMinutes - startMinutes) * 60;

    if (workSeconds <= 0) {
      return;
    }

    const workDays = app.globalData.workDaysPerMonth;
    const perSecondIncome = salaryNum / workDays / workSeconds;

    // 检查是否在工作时间内
    if (!this._isWorkTime()) {
      // 不在工作时间内，显示0但保持canStart为true以便用户手动开始
      this.setData({
        perSecondIncome,
        perSecondDisplay: perSecondIncome.toFixed(4),
        totalEarned: 0,
        displayAmount: '0.00',
        isRunning: false,
        canStart: true,
        notWorkTime: true
      });
      return;
    }

    // 计算从上班到现在经过的秒数
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const workedSeconds = (currentMinutes - startMinutes) * 60;

    // 加上当前这一分钟的秒数
    const currentSecond = now.getSeconds();
    const totalWorkedSeconds = workedSeconds + currentSecond;

    if (totalWorkedSeconds <= 0) {
      return;
    }

    const totalEarned = totalWorkedSeconds * perSecondIncome;

    // 设置数据并开始计时
    this.setData({
      perSecondIncome,
      perSecondDisplay: perSecondIncome.toFixed(4),
      totalEarned,
      displayAmount: totalEarned.toFixed(2),
      isRunning: true,
      canStart: true,
      notWorkTime: false,
      showCanvas: true
    });

    // 记录上次tick时间
    this._lastTickTime = Date.now();

    // 延迟初始化 Canvas
    setTimeout(() => {
      this._initCanvas();
    }, 100);

    // 启动定时器
    this._startInterval();
  },

  // ==================== 用户输入处理 ====================
  _loadSettings() {
    const salary = wx.getStorageSync('salary') || '';
    const startTime = wx.getStorageSync('startTime') || '09:00';
    const endTime = wx.getStorageSync('endTime') || '18:00';
    this.setData({ salary, startTime, endTime });
  },

  _saveSettings() {
    wx.setStorageSync('salary', this.data.salary);
    wx.setStorageSync('startTime', this.data.startTime);
    wx.setStorageSync('endTime', this.data.endTime);
  },

  // ==================== 用户输入处理 ====================
  onSalaryInput(e) {
    const salary = e.detail.value;
    this.setData({ salary });
    this._saveSettings();
    this._recalculate();
  },

  onStartTimeChange(e) {
    this.setData({ startTime: e.detail.value });
    this._saveSettings();
    this._recalculate();
  },

  onEndTimeChange(e) {
    this.setData({ endTime: e.detail.value });
    this._saveSettings();
    this._recalculate();
  },

  // ==================== 计算逻辑 ====================
  _recalculate() {
    const { salary, startTime, endTime } = this.data;
    const salaryNum = parseFloat(salary);

    if (!salaryNum || salaryNum <= 0 || !startTime || !endTime) {
      this.setData({ 
        canStart: false, 
        perSecondIncome: 0,
        perSecondDisplay: '0.0000'
      });
      return;
    }

    // 计算每日工作秒数
    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
    const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
    const workMinutes = endMinutes - startMinutes;

    if (workMinutes <= 0) {
      this.setData({ 
        canStart: false, 
        perSecondIncome: 0,
        perSecondDisplay: '0.0000'
      });
      return;
    }

    const workSeconds = workMinutes * 60;
    const workDays = app.globalData.workDaysPerMonth;
    const perSecondIncome = salaryNum / workDays / workSeconds;

    this.setData({
      perSecondIncome,
      perSecondDisplay: perSecondIncome.toFixed(4),
      canStart: true
    });

    // 如果正在运行，修改参数后重置
    if (this.data.isRunning) {
      this._resetState();
    }
  },

  // ==================== 开始/暂停 ====================
  toggleTimer() {
    if (this.data.isRunning) {
      this._pause();
    } else {
      this._start();
    }
  },

  _start() {
    // 检查是否在工作时间内
    if (!this._isWorkTime()) {
      this.setData({ notWorkTime: true });
      wx.showToast({
        title: '当前未到工作时间',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    this.setData({ 
      isRunning: true, 
      notWorkTime: false,
      showCanvas: true
    });

    // 重新初始化 Canvas（因为 showCanvas 变化）
    setTimeout(() => {
      this._initCanvas();
    }, 100);

    this._lastTickTime = Date.now();
    this._startInterval();
  },

  _pause() {
    this._clearInterval();
    this.setData({ isRunning: false });
  },

  _startInterval() {
    this._clearInterval();
    this._timer = setInterval(() => {
      this._tick();
    }, 1000);
  },

  _clearInterval() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _tick() {
    const now = Date.now();
    const elapsed = (now - this._lastTickTime) / 1000;
    this._lastTickTime = now;

    const increment = elapsed * this.data.perSecondIncome;
    const newTotal = this.data.totalEarned + increment;

    this.setData({
      totalEarned: newTotal,
      displayAmount: newTotal.toFixed(2)
    });

    this._checkTrigger(newTotal);

    // 检查是否超过下班时间
    if (!this._isWorkTime()) {
      this._pause();
      wx.showToast({
        title: '下班啦！今天辛苦了 🎉',
        icon: 'none',
        duration: 3000
      });
    }
  },

  // ==================== 工作时间检查 ====================
  _isWorkTime() {
    const { startTime, endTime } = this.data;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startParts = startTime.split(':');
    const endParts = endTime.split(':');
    const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
    const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  },

  // ==================== 触发检查（10元整数倍） ====================
  _checkTrigger(amount) {
    const currentMultiple = Math.floor(amount / 10);
    if (currentMultiple > this._lastTriggerMultiple && currentMultiple > 0) {
      this._lastTriggerMultiple = currentMultiple;
      this._triggerCoinEffect();
    }
  },

  // ==================== 金币特效 ====================
  _triggerCoinEffect() {
    // 播放音效
    if (this.data.soundEnabled) {
      this._playSound();
    }

    // 启动金币掉落动画
    this._spawnCoins(12);
  },

  _playSound() {
    if (this._audioContext) {
      this._audioContext.stop();
      this._audioContext.seek(0);
      this._audioContext.play();
    }
  },

  // ==================== 金币动画（Canvas） ====================
  _spawnCoins(count) {
    if (!this._canvasCtx || !this._canvas) {
      // Canvas 未就绪，尝试重新初始化
      this._initCanvas();
      return;
    }

    for (let i = 0; i < count; i++) {
      this._coins.push({
        x: Math.random() * this._canvasWidth,
        y: -30 - Math.random() * 100,
        vx: (Math.random() - 0.5) * 3,  // 左右偏移速度
        vy: 2 + Math.random() * 4,       // 下落速度
        size: 20 + Math.random() * 15,
        opacity: 1,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
        phase: Math.random() * Math.PI * 2, // 用于摆动
      });
    }

    if (!this._animFrameId) {
      this._animateCoinFrame();
    }
  },

  _animateCoinFrame() {
    if (!this._canvasCtx || !this._canvas) return;

    const ctx = this._canvasCtx;
    ctx.clearRect(0, 0, this._canvasWidth, this._canvasHeight);

    // 更新和绘制每个金币
    for (let i = this._coins.length - 1; i >= 0; i--) {
      const coin = this._coins[i];

      // 更新位置
      coin.x += coin.vx + Math.sin(coin.phase) * 0.5;
      coin.y += coin.vy;
      coin.phase += 0.05;
      coin.rotation += coin.rotationSpeed;

      // 接近底部时淡出
      if (coin.y > this._canvasHeight * 0.75) {
        coin.opacity -= 0.03;
      }

      // 移除已消失的金币
      if (coin.opacity <= 0 || coin.y > this._canvasHeight + 50) {
        this._coins.splice(i, 1);
        continue;
      }

      // 绘制金币
      this._drawCoin(ctx, coin);
    }

    // 继续动画或停止
    if (this._coins.length > 0) {
      this._animFrameId = this._canvas.requestAnimationFrame(() => {
        this._animateCoinFrame();
      });
    } else {
      this._animFrameId = null;
    }
  },

  _drawCoin(ctx, coin) {
    ctx.save();
    ctx.globalAlpha = coin.opacity;
    ctx.translate(coin.x, coin.y);
    ctx.rotate(coin.rotation);

    const s = coin.size;

    // 金币外圈
    ctx.beginPath();
    ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#f5c842';
    ctx.fill();
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 金币内圈
    ctx.beginPath();
    ctx.arc(0, 0, s / 2 - 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 金币上的 ¥ 符号
    ctx.fillStyle = '#b8860b';
    ctx.font = `bold ${Math.floor(s * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('¥', 0, 0);

    ctx.restore();
  },

  _stopCoinAnimation() {
    this._coins = [];
    if (this._animFrameId && this._canvas) {
      this._canvas.cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    if (this._canvasCtx) {
      this._canvasCtx.clearRect(0, 0, this._canvasWidth, this._canvasHeight);
    }
  },

  // ==================== 重置 ====================
  resetAll() {
    this._clearInterval();
    this._stopCoinAnimation();
    this._lastTriggerMultiple = 0;

    // 重置时根据当前系统时间重新计算
    this._autoStartIfInWorkHours();
  },

  _resetState() {
    this._clearInterval();
    this._lastTriggerMultiple = 0;

    // 修改参数后根据当前时间重新计算
    this._autoStartIfInWorkHours();
  },

  // ==================== 音效开关 ====================
  toggleSound(e) {
    this.setData({
      soundEnabled: e.detail.value
    });
  }
});
