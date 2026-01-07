class cpmcylone {
    constructor() {
        this.baseUrl = window.location.origin;
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        this.isProcessing = false;
        this.cloneTimeout = null;
        this.startTime = null;
        console.log('cpmcy Clone 初始化成功. 基础URL:', this.baseUrl);
    }

    init() {
        this.bindEvents();
        this.checkSession();
        this.testConnection();
        this.initStepIndicator();
        this.initOperationType();
    }

    initStepIndicator() {
        const cloneSection = document.getElementById('clone-section');
        if (cloneSection) {
            const stepHtml = `
                <div class="step-indicator">
                    <div class="step active" id="step-1">
                        <div class="step-number">1</div>
                        <div class="step-text">登录源账号</div>
                    </div>
                    <div class="step" id="step-2">
                        <div class="step-number">2</div>
                        <div class="step-text">选择操作类型</div>
                    </div>
                    <div class="step" id="step-3">
                        <div class="step-number">3</div>
                        <div class="step-text">开始执行</div>
                    </div>
                </div>
            `;
            cloneSection.insertAdjacentHTML('afterbegin', stepHtml);
        }
    }

    updateStep(stepNumber) {
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
            }
        }

        for (let i = 1; i <= stepNumber; i++) {
            const step = document.getElementById(`step-${i}`);
            if (step) {
                if (i < stepNumber) {
                    step.classList.add('completed');
                } else {
                    step.classList.add('active');
                }
            }
        }
    }

    initOperationType() {
        const operationRadios = document.querySelectorAll('input[name="operation-type"]');
        operationRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.updateOperationUI(e.target.value);
            });
        });
        
        this.updateOperationUI('modify-id');
    }

    updateOperationUI(operationType) {
        const targetCredentials = document.getElementById('target-credentials');
        const warning = document.querySelector('.warning');
        const cloneBtn = document.getElementById('clone-btn');
        
        if (operationType === 'modify-id') {
            this.hideElement('target-credentials');
            
            if (warning) {
                warning.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>警告：</strong> 这将修改当前账号的Local ID！请确保新ID的唯一性！
                `;
            }
            
            if (cloneBtn) {
                cloneBtn.innerHTML = '<i class="fas fa-user-edit"></i> 修改当前账号ID';
            }
            
        } else if (operationType === 'clone-to-new') {
            this.showElement('target-credentials');
            
            if (warning) {
                warning.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>警告：</strong> 这将覆盖目标账号的所有数据！请谨慎操作！
                `;
            }
            
            if (cloneBtn) {
                cloneBtn.innerHTML = '<i class="fas fa-clone"></i> 开始克隆';
            }
        }
    }

    bindEvents() {
        const loginBtn = document.getElementById('login-btn');
        const cloneBtn = document.getElementById('clone-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.login());
            console.log('登录按钮绑定成功');
        }
        
        if (cloneBtn) {
            cloneBtn.addEventListener('click', () => this.cloneAccount());
            console.log('克隆按钮绑定成功');
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
            console.log('退出按钮绑定成功');
        }
        
        const sourceEmail = document.getElementById('source-email');
        const sourcePass = document.getElementById('source-password');
        const targetEmail = document.getElementById('target-email');
        const targetPass = document.getElementById('target-password');
        const customLocalId = document.getElementById('custom-localid');
        
        const addEnterHandler = (input, nextInput, callback) => {
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (nextInput) {
                            nextInput.focus();
                        }
                        if (callback) {
                            callback();
                        }
                    }
                });
            }
        };
        
        addEnterHandler(sourceEmail, sourcePass);
        addEnterHandler(sourcePass, null, () => this.login());
        addEnterHandler(targetEmail, targetPass);
        addEnterHandler(targetPass, customLocalId);
        addEnterHandler(customLocalId, null, () => this.cloneAccount());
    }

    async testConnection() {
        try {
            console.log('测试API连接...');
            const response = await fetch(`${this.baseUrl}/api/test`);
            const data = await response.json();
            console.log('API测试结果:', data);
            
            if (data.status === 'ok') {
                this.addLog('✓ API连接正常');
            } else {
                this.addLog('⚠ API连接测试失败');
            }
        } catch (error) {
            console.error('API连接测试失败:', error);
            this.addLog('⚠ API连接测试失败');
        }
    }

    checkSession() {
        const savedAuth = localStorage.getItem('jbcacc_auth');
        if (savedAuth) {
            this.sourceAuth = savedAuth;
            this.hideElement('login-section');
            this.showElement('clone-section');
            this.showElement('account-info-section');
            this.showStatus('info', '检测到上次登录会话，正在验证...', 'login-status');
            console.log('从localStorage恢复会话');
            
            this.verifyAndLoadAccount(savedAuth);
        }
    }

    async verifyAndLoadAccount(authToken) {
        try {
            this.updateStep(1);
            const response = await fetch(`${this.baseUrl}/api/get-account-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            if (data.ok) {
                this.sourceAccountInfo = data.data;
                this.displayAccountInfo(data.data);
                this.showStatus('success', '会话验证成功！', 'login-status');
                this.updateStep(2);
                
                await this.loadCarsCount(authToken);
            } else {
                this.logout();
                this.showStatus('error', '会话已过期，请重新登录', 'login-status');
            }
        } catch (error) {
            console.log('会话验证失败:', error);
            this.logout();
        }
    }

    async loadCarsCount(authToken) {
        try {
            const response = await fetch(`${this.baseUrl}/api/get-all-cars`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authToken })
            });
            
            const data = await response.json();
            if (data.ok && Array.isArray(data.data)) {
                const carsCount = data.data.length;
                document.getElementById('account-cars').textContent = carsCount;
            }
        } catch (error) {
            console.log('获取车辆数量失败:', error);
        }
    }

    displayAccountInfo(accountData) {
        if (!accountData) return;
        
        const name = accountData.Name || accountData.username || '未知';
        document.getElementById('account-name').textContent = name;
        
        const money = accountData.money || accountData.Money || 0;
        document.getElementById('account-money').textContent = this.formatNumber(money);
        
        const localID = accountData.localID || accountData.localId || '未知';
        document.getElementById('account-localid').textContent = localID;
        
        const statusBadge = document.getElementById('account-status');
        statusBadge.textContent = '已登录';
        statusBadge.setAttribute('data-status', 'online');
    }

    formatNumber(num) {
        return Number(num).toLocaleString('zh-CN');
    }

    async login() {
        if (this.isProcessing) {
            console.log('正在处理中，请稍候...');
            this.showStatus('error', '请等待，另一个操作正在进行中', 'login-status');
            return;
        }

        const emailInput = document.getElementById('source-email');
        const passwordInput = document.getElementById('source-password');
        
        if (!emailInput || !passwordInput) {
            console.error('邮箱或密码输入框未找到');
            return;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            this.showStatus('error', '请输入邮箱和密码', 'login-status');
            return;
        }

        if (!email.includes('@') || !email.includes('.')) {
            this.showStatus('error', '请输入有效的邮箱地址', 'login-status');
            return;
        }

        this.isProcessing = true;
        this.updateButtonState('login-btn', true, '验证中...');
        this.showStatus('info', '正在连接服务器...', 'login-status');
        this.addLog('正在登录账号...');

        try {
            console.log('正在登录:', email);
            const response = await fetch(`${this.baseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            console.log('登录响应状态:', response.status);
            const data = await response.json();
            console.log('登录响应数据:', data);

            if (data.ok) {
                this.sourceAuth = data.auth;
                this.sourceAccountInfo = null;
                localStorage.setItem('jbcacc_auth', data.auth);
                this.showStatus('success', '登录成功！正在获取账号信息...', 'login-status');
                this.hideElement('login-section');
                this.showElement('clone-section');
                this.showElement('account-info-section');
                this.updateProgress('登录成功', 25);
                this.addLog('✓ 登录成功');
                this.updateStep(1);
                
                await this.verifyAndLoadAccount(data.auth);
                
                const targetEmailInput = document.getElementById('target-email');
                if (targetEmailInput && !targetEmailInput.value) {
                    targetEmailInput.value = email;
                    targetEmailInput.focus();
                }
                
            } else {
                let errorMsg = data.message || '登录失败';
                if (data.error === 100) errorMsg = '邮箱未找到 - 请检查邮箱地址';
                if (data.error === 101) errorMsg = '密码错误 - 请检查密码';
                if (data.error === 107) errorMsg = '邮箱格式无效';
                if (data.error === 108) errorMsg = '请输入邮箱';
                if (data.error === 106) errorMsg = '请输入密码';
                
                this.showStatus('error', `登录失败: ${errorMsg}`, 'login-status');
                this.addLog(`✗ 登录失败: ${errorMsg}`);
                
                if (data.error === 101) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        } catch (error) {
            console.error('登录错误:', error);
            this.showStatus('error', `网络错误: ${error.message}。请检查网络连接。`, 'login-status');
            this.addLog(`✗ 网络错误: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.updateButtonState('login-btn', false, '登录并验证账号');
        }
    }

    logout() {
        this.sourceAuth = null;
        this.sourceAccountInfo = null;
        localStorage.removeItem('jbcacc_auth');
        
        this.showElement('login-section');
        this.hideElement('clone-section');
        this.hideElement('account-info-section');
        
        document.getElementById('source-email').value = '';
        document.getElementById('source-password').value = '';
        
        document.getElementById('account-name').textContent = '--';
        document.getElementById('account-money').textContent = '--';
        document.getElementById('account-cars').textContent = '--';
        document.getElementById('account-localid').textContent = '--';
        
        const statusBadge = document.getElementById('account-status');
        statusBadge.textContent = '未登录';
        statusBadge.setAttribute('data-status', 'offline');
        
        this.showStatus('info', '已退出登录', 'login-status');
        this.addLog('已退出登录');
        this.updateStep(1);
    }

    async cloneAccount() {
        if (this.isProcessing) {
            console.log('正在处理中，请稍候...');
            this.showStatus('error', '请等待，另一个操作正在进行中', 'clone-status');
            return;
        }

        if (!this.sourceAuth) {
            console.log('没有可用的认证令牌');
            this.showStatus('error', '请先登录源账号', 'clone-status');
            this.addLog('✗ 未找到认证令牌');
            return;
        }

        const operationType = document.querySelector('input[name="operation-type"]:checked').value;
        const customLocalId = document.getElementById('custom-localid').value.trim();
        
        if (!customLocalId) {
            this.showStatus('error', '请输入自定义的Local ID', 'clone-status');
            return;
        }

        if (operationType === 'clone-to-new') {
            const targetEmailInput = document.getElementById('target-email');
            const targetPasswordInput = document.getElementById('target-password');
            
            if (!targetEmailInput || !targetPasswordInput) {
                console.error('目标邮箱或密码输入框未找到');
                return;
            }

            const targetEmail = targetEmailInput.value.trim();
            const targetPassword = targetPasswordInput.value;

            if (!targetEmail || !targetPassword) {
                this.showStatus('error', '请输入目标账号的凭据', 'clone-status');
                return;
            }

            if (!targetEmail.includes('@') || !targetEmail.includes('.')) {
                this.showStatus('error', '请输入有效的目标邮箱地址', 'clone-status');
                return;
            }

            const confirmMessage = `⚠️ 警告：这将完全覆盖目标账号的所有数据！\n\n` +
                                  `目标账号: ${targetEmail}\n` +
                                  `新Local ID: ${customLocalId}\n\n` +
                                  `源账号车辆: ${document.getElementById('account-cars').textContent} 辆\n` +
                                  `源账号金币: ${document.getElementById('account-money').textContent}\n\n` +
                                  `你确定要继续吗？`;
            
            if (!confirm(confirmMessage)) {
                this.addLog('✗ 用户取消操作');
                return;
            }

            this.isProcessing = true;
            this.startTime = Date.now();
            this.updateButtonState('clone-btn', true, '克隆中...');
            this.clearStatusLog();
            this.updateProgress('开始克隆流程...', 5);
            this.updateTimeEstimate();
            this.addLog('开始克隆到新账号...');
            this.addLog(`新Local ID: ${customLocalId}`);
            this.updateStep(3);

            this.cloneTimeout = setTimeout(() => {
                if (this.isProcessing) {
                    this.addLog('⚠ 克隆请求超时，但可能仍在后台处理中...');
                    this.updateTimeEstimate('超时，但可能仍在处理');
                }
            }, 120000);

            try {
                this.addLog('1. 正在向服务器发送克隆请求...');
                this.updateProgress('正在发送请求到服务器...', 10);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 180000);
                
                const response = await fetch(`${this.baseUrl}/api/clone-account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceAuth: this.sourceAuth,
                        targetEmail: targetEmail,
                        targetPassword: targetPassword,
                        customLocalId: customLocalId
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                this.updateProgress('正在处理克隆请求...', 30);
                
                const data = await response.json();
                console.log('克隆响应:', data);

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('克隆完成！', 100);
                    this.addLog('✓ 克隆成功！');
                    this.addLog(`目标账号: ${targetEmail}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`已克隆车辆: ${data.details?.carsCloned || '未知'} 辆`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `账号克隆成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    targetEmailInput.value = '';
                    targetPasswordInput.value = '';
                    document.getElementById('custom-localid').value = '';
                    
                    this.addLog('5秒后刷新页面...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    let errorMsg = data.message || '克隆失败，未知错误';
                    if (data.error === 100) errorMsg = '目标账号邮箱未找到';
                    if (data.error === 101) errorMsg = '目标账号密码错误';
                    if (data.error === 400) errorMsg = '缺少必要参数';
                    if (data.error === 401) errorMsg = '认证失败';
                    if (data.error === 500) errorMsg = '克隆过程中服务器错误';
                    
                    throw new Error(errorMsg);
                }

            } catch (error) {
                clearTimeout(this.cloneTimeout);
                console.error('克隆错误:', error);
                
                if (error.name === 'AbortError') {
                    this.addLog('⚠ 请求超时，但克隆可能仍在后台进行中');
                    this.addLog('⚠ 请等待几分钟后检查目标账号');
                    this.showStatus('warning', '请求超时，但克隆可能仍在后台进行中。请稍后检查目标账号。', 'clone-status');
                } else {
                    this.addLog(`✗ 错误: ${error.message}`);
                    this.showStatus('error', `克隆失败: ${error.message}`, 'clone-status');
                }
                
                this.updateProgress('克隆中断', 0);
                this.updateTimeEstimate('已中断');
                this.showErrorAnimation();
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '开始克隆');
            }
            
        } else if (operationType === 'modify-id') {
            const currentLocalId = document.getElementById('account-localid').textContent;
            const confirmMessage = `⚠️ 确认修改当前账号Local ID？\n\n` +
                                  `当前Local ID: ${currentLocalId}\n` +
                                  `新的Local ID: ${customLocalId}\n\n` +
                                  `此操作会更新所有车辆数据中的Local ID引用。`;
            
            if (!confirm(confirmMessage)) {
                this.addLog('✗ 用户取消操作');
                return;
            }

            this.isProcessing = true;
            this.startTime = Date.now();
            this.updateButtonState('clone-btn', true, '修改中...');
            this.clearStatusLog();
            this.updateProgress('开始修改ID流程...', 5);
            this.updateTimeEstimate();
            this.addLog('开始修改当前账号ID...');
            this.addLog(`新Local ID: ${customLocalId}`);
            this.updateStep(3);

            this.cloneTimeout = setTimeout(() => {
                if (this.isProcessing) {
                    this.addLog('⚠ 修改请求超时，但可能仍在后台处理中...');
                    this.updateTimeEstimate('超时，但可能仍在处理');
                }
            }, 120000);

            try {
                this.addLog('1. 正在向服务器发送修改请求...');
                this.updateProgress('正在发送请求到服务器...', 10);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 180000);
                
                const response = await fetch(`${this.baseUrl}/api/change-localid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        authToken: this.sourceAuth,
                        newLocalId: customLocalId
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                this.updateProgress('正在处理修改请求...', 30);
                
                const data = await response.json();
                console.log('修改响应:', data);

                clearTimeout(this.cloneTimeout);

                if (data.ok) {
                    const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
                    this.updateProgress('修改完成！', 100);
                    this.addLog('✓ ID修改成功！');
                    this.addLog(`旧Local ID: ${currentLocalId}`);
                    this.addLog(`新Local ID: ${customLocalId}`);
                    this.addLog(`更新车辆: ${data.details?.carsUpdated || '未知'} 辆`);
                    this.addLog(`总耗时: ${elapsedTime} 秒`);
                    this.showStatus('success', `ID修改成功！耗时 ${elapsedTime} 秒`, 'clone-status');
                    this.updateTimeEstimate('已完成');
                    
                    this.showSuccessAnimation();
                    
                    document.getElementById('account-localid').textContent = customLocalId;
                    
                    document.getElementById('custom-localid').value = '';
                    
                    this.addLog('5秒后刷新页面...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    let errorMsg = data.message || '修改失败，未知错误';
                    throw new Error(errorMsg);
                }

            } catch (error) {
                clearTimeout(this.cloneTimeout);
                console.error('修改错误:', error);
                
                this.addLog(`✗ 错误: ${error.message}`);
                this.showStatus('error', `修改失败: ${error.message}`, 'clone-status');
                
                this.updateProgress('修改中断', 0);
                this.updateTimeEstimate('已中断');
                this.showErrorAnimation();
            } finally {
                this.isProcessing = false;
                this.updateButtonState('clone-btn', false, '修改当前账号ID');
            }
        }
    }

    updateTimeEstimate(text) {
        const timeEstimate = document.getElementById('time-estimate');
        if (!timeEstimate) return;
        
        if (text) {
            timeEstimate.textContent = `预计时间: ${text}`;
        } else if (this.startTime && this.isProcessing) {
            const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            timeEstimate.textContent = `已用时: ${minutes}分${seconds}秒`;
        }
    }

    showSuccessAnimation() {
        try {
            const successDiv = document.createElement('div');
            successDiv.innerHTML = '✓';
            successDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 80px;
                color: #2ecc71;
                z-index: 1000;
                animation: successPulse 1.5s ease-out;
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes successPulse {
                    0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
                    50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
                    100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(successDiv);
            
            setTimeout(() => {
                document.body.removeChild(successDiv);
            }, 1500);
        } catch (e) {
            console.log('无法显示成功动画');
        }
    }

    showErrorAnimation() {
        try {
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = '✗';
            errorDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 80px;
                color: #e74c3c;
                z-index: 1000;
                animation: errorShake 0.5s ease-out;
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes errorShake {
                    0%, 100% { transform: translate(-50%, -50%) translateX(0); }
                    10%, 30%, 50%, 70%, 90% { transform: translate(-50%, -50%) translateX(-5px); }
                    20%, 40%, 60%, 80% { transform: translate(-50%, -50%) translateX(5px); }
                }
            `;
            
            document.head.appendChild(style);
            document.body.appendChild(errorDiv);
            
            setTimeout(() => {
                document.body.removeChild(errorDiv);
            }, 1000);
        } catch (e) {
            console.log('无法显示错误动画');
        }
    }

    showStatus(type, message, elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`未找到元素: ${elementId}`);
            return;
        }
        
        element.textContent = message;
        element.className = `status ${type}`;
        element.style.display = 'block';
        
        if (type === 'success') {
            setTimeout(() => {
                element.style.display = 'none';
            }, 8000);
        }
        
        console.log(`${type.toUpperCase()}: ${message}`);
    }

    addLog(message) {
        const logContainer = document.getElementById('status-log');
        if (!logContainer) {
            console.log('日志:', message);
            return;
        }
        
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        
        let iconClass = 'fa-info-circle';
        if (message.startsWith('✓')) iconClass = 'fa-check-circle';
        else if (message.startsWith('✗')) iconClass = 'fa-times-circle';
        else if (message.startsWith('⚠')) iconClass = 'fa-exclamation-triangle';
        else if (/^\d+\./.test(message)) iconClass = 'fa-arrow-right';
        
        logEntry.innerHTML = `<i class="fas ${iconClass}"></i> ${message}`;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        console.log('日志:', message);
        
        if (this.isProcessing) {
            this.updateTimeEstimate();
        }
    }

    clearStatusLog() {
        const logContainer = document.getElementById('status-log');
        if (logContainer) {
            logContainer.innerHTML = '';
        }
    }

    updateProgress(message, percentage) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        
        if (progressBar) {
            progressBar.style.width = `${percentage}%`;
            progressBar.style.transition = 'width 0.5s ease';
            
            if (percentage < 30) {
                progressBar.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
            } else if (percentage < 70) {
                progressBar.style.background = 'linear-gradient(135deg, #f39c12 0%, #d35400 100%)';
            } else if (percentage < 100) {
                progressBar.style.background = 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)';
            } else {
                progressBar.style.background = 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)';
            }
        }
        
        if (progressText) {
            progressText.textContent = message;
            progressText.style.fontWeight = 'bold';
        }
    }

    updateButtonState(buttonId, disabled, text) {
        const button = document.getElementById(buttonId);
        if (!button) {
            console.error(`未找到按钮: ${buttonId}`);
            return;
        }
        
        button.disabled = disabled;
        if (disabled) {
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
            button.style.opacity = '0.7';
            button.style.cursor = 'not-allowed';
        } else {
            const icon = buttonId === 'login-btn' ? 'fa-key' : 
                        buttonId === 'clone-btn' ? 'fa-clone' : 'fa-sign-out-alt';
            button.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    }

    hideElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.add('hidden');
            element.style.display = 'none';
        }
    }

    showElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('hidden');
            element.style.display = 'block';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM加载完成');
    
    try {
        const app = new cpmcylone();
        app.init();
        console.log('cpmcy Clone应用初始化成功');
        
        console.log('应用版本: 2.2');
        console.log('环境:', window.location.origin.includes('localhost') ? '开发环境' : '生产环境');
        
    } catch (error) {
        console.error('应用初始化失败:', error);
        
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #e74c3c;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            max-width: 500px;
            text-align: center;
        `;
        errorDiv.innerHTML = `
            <strong>应用错误</strong><br>
            应用初始化失败，请刷新页面。<br>
            <small>错误: ${error.message}</small>
        `;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            document.body.removeChild(errorDiv);
        }, 10000);
    }
});
