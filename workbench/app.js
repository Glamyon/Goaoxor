/* app.js for Goaoxor admin
   - 必须与 admin.html / styles.css 同目录
   - 导出文件名: goaoxor_data_YYYYMMDD_HHMMSS.json
*/

/* ---------- 全局数据和工具 ---------- */
let appData = {
  version: "1.0.0",
  admins: [],
  orders: [],
  contracts: [],
  logs: [],
  settings: {}
};

let trendChart = null;

/* helper: 格式化时间为 YYYYMMDD_HHMMSS */
function formatTimestampForFilename(d = new Date()){
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* helper: ISO 日期字符串 -> 本地展示短格式（用于表格） */
function formatLocal(dtIso){
  try { return new Date(dtIso).toLocaleString(); } catch(e){ return dtIso; }
}

/* 安全输入 */
function clean(v){ return DOMPurify.sanitize(String(v || "")); }

/* ---------- 初始化默认数据（含默认管理员） ---------- */
async function initializeDefaultData(){
  const defaultAdmin = {
    username: 'admin',
    password: await sha256('123456'),
    lastLogin: '未记录'
  };
  // 如果上传文件前无管理员则初始化
  if(!appData.admins || appData.admins.length === 0) {
    appData.admins = [defaultAdmin];
  }
  if(!appData.orders) appData.orders = [];
  if(!appData.contracts) appData.contracts = [];
  if(!appData.logs) appData.logs = [];
  loadAdminList();
}

/* SHA-256 helper */
async function sha256(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* 记录日志 */
function logAction(action, username){
  const entry = { action, username: username || 'system', timestamp: (new Date()).toLocaleString(), iso: (new Date()).toISOString() };
  appData.logs.push(entry);
  // console.debug('log', entry);
}

/* ---------- 管理员下拉列表加载 ---------- */
function loadAdminList(){
  const sel = document.getElementById('usernameInput');
  sel.innerHTML = '<option value="" disabled selected>选择管理员账户</option>';
  (appData.admins || []).forEach(a => {
    const op = document.createElement('option');
    op.value = a.username;
    op.textContent = a.username;
    sel.appendChild(op);
  });
}

/* ---------- 导入 JSON 文件（全量恢复） ---------- */
document.getElementById('dataFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    try{
      const data = JSON.parse(ev.target.result);
      // 检查基础结构
      if(data.admins && data.orders && data.contracts && data.logs){
        appData = data;
        // backward compatibility: ensure arrays exist
        appData.admins = appData.admins || [];
        appData.orders = appData.orders || [];
        appData.contracts = appData.contracts || [];
        appData.logs = appData.logs || [];
        initializeAfterLoad();
        document.getElementById('loginMsg').className = 'text-success';
        document.getElementById('loginMsg').textContent = '数据文件加载成功（已覆盖当前数据）';
      } else {
        throw new Error('文件结构不正确');
      }
    } catch(err){
      document.getElementById('loginMsg').className = 'text-danger';
      document.getElementById('loginMsg').textContent = '加载失败：文件格式错误';
      console.error(err);
    }
  };
  reader.readAsText(file);
});

/* 初始化完成后的加载（刷新 UI） */
function initializeAfterLoad(){
  loadAdminList();
  fetchAdmins();
  renderStatistics();
}

/* ---------- 登录 ---------- */
document.getElementById('loginBtn').addEventListener('click', async ()=>{
  const username = clean(document.getElementById('usernameInput').value);
  const pwd = document.getElementById('passwordInput').value;
  const msgEl = document.getElementById('loginMsg');
  msgEl.textContent = '';
  if(!username || !pwd){ msgEl.textContent = '请选择管理员并输入密码'; return; }
  try{
    const hashed = await sha256(pwd);
    const admin = (appData.admins || []).find(a => a.username === username && a.password === hashed);
    if(!admin){ msgEl.textContent = '用户名或密码错误'; return; }
    sessionStorage.setItem('currentUser', username);
    admin.lastLogin = new Date().toLocaleString();
    logAction('登录', username);
    // 切换界面
    document.getElementById('loginDiv').style.display = 'none';
    document.getElementById('mainDiv').style.display = 'flex';
    document.getElementById('currentUser').textContent = username;
    document.getElementById('lastLogin').textContent = admin.lastLogin;
    document.getElementById('passwordInput').value = '';
    // refresh UI
    fetchAdmins();
    fetchOrders();
    fetchContracts();
    renderStatistics();
  } catch(e){
    msgEl.textContent = '登录失败';
    console.error(e);
  }
});

/* ---------- 添加管理员 ---------- */
document.getElementById('adminForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = clean(document.getElementById('newUsername').value);
  const pwd = document.getElementById('newAdminPassword').value;
  const confirm = document.getElementById('confirmAdminPassword').value;
  const msg = document.getElementById('adminMsg');
  msg.textContent = '';
  if(pwd !== confirm){ msg.textContent = '两次密码不一致'; return; }
  if(pwd.length < 6){ msg.textContent = '密码至少6位'; return; }
  if(appData.admins.find(a=>a.username === username)){ msg.textContent = '用户名已存在'; return; }
  try{
    const hashed = await sha256(pwd);
    appData.admins.push({ username, password: hashed, lastLogin: '未记录' });
    logAction(`添加管理员: ${username}`, sessionStorage.getItem('currentUser'));
    msg.className = 'text-success';
    msg.textContent = '添加成功';
    document.getElementById('adminForm').reset();
    loadAdminList();
    fetchAdmins();
  } catch(e){
    msg.textContent = '添加失败';
  }
});

function deleteAdmin(username){
  if(appData.admins.length <= 1){ alert('无法删除最后一个管理员'); return; }
  if(username === sessionStorage.getItem('currentUser')){ alert('无法删除当前登录用户'); return; }
  if(!confirm(`确认删除管理员 ${username} ?`)) return;
  appData.admins = appData.admins.filter(a=>a.username !== username);
  logAction(`删除管理员: ${username}`, sessionStorage.getItem('currentUser'));
  loadAdminList();
  fetchAdmins();
}

function fetchAdmins(){
  const tbody = document.getElementById('adminTableBody');
  tbody.innerHTML = '';
  (appData.admins || []).forEach(a=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${a.username}</td><td>${a.lastLogin || '未记录'}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteAdmin('${a.username}')">删除</button></td>`;
    tbody.appendChild(tr);
  });
}

/* ---------- 修改密码 ---------- */
document.getElementById('changeBtn').addEventListener('click', async ()=>{
  const oldPwd = document.getElementById('oldPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirmPwd = document.getElementById('confirmPassword').value;
  const msg = document.getElementById('changeMsg');
  msg.textContent = '';
  const username = sessionStorage.getItem('currentUser');
  if(!username){ msg.textContent = '未登录'; return; }
  if(newPwd !== confirmPwd){ msg.textContent = '两次密码不一致'; return; }
  if(newPwd.length < 6){ msg.textContent = '新密码至少6位'; return; }
  const admin = appData.admins.find(a=>a.username === username);
  try{
    const hashedOld = await sha256(oldPwd);
    if(admin.password !== hashedOld){ msg.textContent = '旧密码不正确'; return; }
    admin.password = await sha256(newPwd);
    logAction('修改密码', username);
    msg.className = 'text-success';
    msg.textContent = '密码修改成功';
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch(e){
    msg.textContent = '修改失败';
  }
});

/* ---------- 费用计算 ---------- */
function calculateFees(projectValue){
  let clientFee, providerFee;
  if (projectValue <= 300) {
    clientFee = 30;
    providerFee = Math.max(10, Math.min(30, projectValue * 0.1));
  } else if (projectValue <= 800) {
    clientFee = 50;
    providerFee = Math.max(30, Math.min(80, projectValue * 0.1));
  } else if (projectValue <= 2000) {
    clientFee = 80;
    providerFee = Math.max(64, Math.min(160, projectValue * 0.08));
  } else if (projectValue <= 5000) {
    clientFee = 100;
    providerFee = Math.max(120, Math.min(150, projectValue * 0.06));
  } else {
    clientFee = 150;
    providerFee = Math.max(250, Math.min(200, projectValue * 0.05));
  }
  return {
    clientFee,
    providerFee,
    providerDeposit: +(providerFee * 0.2).toFixed(2),
    providerBalance: +(providerFee * 0.8).toFixed(2),
    providerNet: +(projectValue - providerFee).toFixed(2),
    clientCost: +(clientFee + projectValue).toFixed(2)
  };
}

/* ---------- 创建订单 ---------- */
document.getElementById('orderForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const clientName = clean(document.getElementById('clientName').value);
  const clientEmail = clean(document.getElementById('clientEmail').value);
  const projectValue = parseFloat(document.getElementById('projectValue').value);
  const projectType = document.getElementById('projectType').value || 'other';
  const orderStatus = document.getElementById('orderStatus').value || 'pending';
  const deadline = document.getElementById('deadline').value;
  const providerName = clean(document.getElementById('providerName').value);
  const notes = clean(document.getElementById('notes').value);
  const msg = document.getElementById('orderMsg');
  msg.textContent = '';
  if(isNaN(projectValue) || projectValue < 100 || projectValue > 10000){ msg.textContent = '项目价值必须在 $100 - $10000'; return; }
  const fees = calculateFees(projectValue);
  const order = {
    id: (appData.orders.length ? Math.max(...appData.orders.map(o=>o.id)) : 0) + 1,
    client_name: clientName,
    client_email: clientEmail,
    project_value: +projectValue,
    project_type: projectType,
    status: orderStatus,
    deadline,
    provider_name: providerName,
    notes,
    client_fee: fees.clientFee,
    provider_fee: fees.providerFee,
    provider_deposit: fees.providerDeposit,
    provider_balance: fees.providerBalance,
    provider_net: fees.providerNet,
    client_cost: fees.clientCost,
    created_at: new Date().toLocaleString(),
    created_at_iso: new Date().toISOString(),
    updated_at: new Date().toLocaleString()
  };
  appData.orders.push(order);
  logAction(`创建订单: ${order.id}`, sessionStorage.getItem('currentUser'));
  msg.className = 'text-success';
  msg.textContent = '订单创建成功';
  document.getElementById('orderForm').reset();
  fetchOrders();
  renderStatistics();
});

/* ---------- 获取与渲染订单列表 ---------- */
function fetchOrders(){
  const clientName = clean(document.getElementById('filterClientName').value || '');
  const providerName = clean(document.getElementById('filterProviderName').value || '');
  const status = document.getElementById('filterStatus').value || '';
  const filtered = (appData.orders || []).filter(o =>
    (!clientName || o.client_name.toLowerCase().includes(clientName.toLowerCase())) &&
    (!providerName || o.provider_name.toLowerCase().includes(providerName.toLowerCase())) &&
    (!status || o.status === status)
  );
  const tbody = document.getElementById('orderTable');
  tbody.innerHTML = '';
  filtered.forEach(order=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${order.id}</td>
      <td>${order.client_name}</td>
      <td>$${order.project_value.toFixed(2)}</td>
      <td>${order.project_type}</td>
      <td>
        <select onchange="updateOrderStatus(${order.id}, this.value)" class="form-select form-select-sm">
          <option value="pending" ${order.status==='pending'?'selected':''}>待处理</option>
          <option value="in-progress" ${order.status==='in-progress'?'selected':''}>进行中</option>
          <option value="completed" ${order.status==='completed'?'selected':''}>已完成</option>
        </select>
      </td>
      <td>${order.provider_name}</td>
      <td>${order.notes || ''}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="generateContract(${order.id}, 'client')">客户合同</button>
        <button class="btn btn-sm btn-primary" onclick="generateContract(${order.id}, 'provider')">团队合同</button>
        <button class="btn btn-sm btn-secondary" onclick="editOrder(${order.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteOrder(${order.id})">删除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* 更新订单状态 */
function updateOrderStatus(orderId, status){
  const order = appData.orders.find(o=>o.id===orderId);
  if(order){
    order.status = status;
    order.updated_at = new Date().toLocaleString();
    logAction(`更新订单状态: ${orderId} -> ${status}`, sessionStorage.getItem('currentUser'));
    fetchOrders();
    renderStatistics();
  }
}

/* 编辑 / 删除 订单（简单交互） */
function editOrder(orderId){
  const order = appData.orders.find(o=>o.id===orderId);
  if(!order) return alert('订单不存在');
  const newClient = prompt('客户姓名', order.client_name);
  if(newClient === null) return;
  order.client_name = clean(newClient);
  const newProvider = prompt('团队名称', order.provider_name);
  if(newProvider === null) return;
  order.provider_name = clean(newProvider);
  order.updated_at = new Date().toLocaleString();
  logAction(`编辑订单: ${orderId}`, sessionStorage.getItem('currentUser'));
  fetchOrders();
  renderStatistics();
}

function deleteOrder(orderId){
  if(!confirm(`确认删除订单 ${orderId} ?`)) return;
  appData.orders = appData.orders.filter(o=>o.id!==orderId);
  logAction(`删除订单: ${orderId}`, sessionStorage.getItem('currentUser'));
  fetchOrders();
  renderStatistics();
}

/* ---------- 生成合同（保存记录并导出 PDF） ---------- */
function generateContract(orderId, type, clientName = null, providerName = null, projectValue = null, serviceType = null){
  const order = orderId ? appData.orders.find(o=>o.id===orderId) : null;
  const dataSource = order ? {
    id: order.id,
    client_name: order.client_name,
    provider_name: order.provider_name,
    project_value: order.project_value,
    client_fee: order.client_fee,
    provider_fee: order.provider_fee,
    provider_deposit: order.provider_deposit,
    provider_balance: order.provider_balance,
    provider_net: order.provider_net,
    service_type: order.project_type
  } : {
    id: (appData.orders.length ? Math.max(...appData.orders.map(o=>o.id)) : 0) + 1,
    client_name: clean(clientName),
    provider_name: clean(providerName),
    project_value: +projectValue,
    service_type: serviceType,
    ...calculateFees(+projectValue)
  };

  if(!order && (isNaN(dataSource.project_value) || dataSource.project_value < 100 || dataSource.project_value > 10000)){
    document.getElementById('contractMsg').textContent = '项目价值必须在 $100 - $10000';
    return;
  }

  const contract = {
    id: (appData.contracts.length ? Math.max(...appData.contracts.map(c=>c.id)) : 0) + 1,
    order_id: dataSource.id,
    client_name: dataSource.client_name,
    provider_name: dataSource.provider_name,
    project_value: +dataSource.project_value,
    client_fee: dataSource.client_fee || 0,
    provider_fee: dataSource.provider_fee || 0,
    contract_type: type,
    service_type: dataSource.service_type,
    created_at: new Date().toLocaleString(),
    created_at_iso: new Date().toISOString()
  };
  appData.contracts.push(contract);
  logAction(`生成合同: id ${contract.id}`, sessionStorage.getItem('currentUser'));

  // 生成 PDF 并下载
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Goaoxor 合同', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`合同ID: ${contract.id}`, 20, 40);
    doc.text(`订单ID: ${contract.order_id}`, 20, 48);
    doc.text(`客户: ${contract.client_name}`, 20, 56);
    doc.text(`团队: ${contract.provider_name}`, 20, 64);
    doc.text(`项目价值: $${contract.project_value.toFixed(2)}`, 20, 72);
    doc.text(`合同类型: ${type}`, 20, 80);
    doc.text(`服务类型: ${contract.service_type}`, 20, 88);
    doc.text('条款: 知识产权归客户所有。仲裁地: 新加坡。', 20, 110);
    const filename = `contract_order_${contract.order_id}_${type}.pdf`;
    doc.save(filename);
  } catch(e){
    console.error('PDF 生成失败', e);
  }

  fetchContracts();
  renderStatistics();
  const cm = document.getElementById('contractMsg');
  cm.className = 'text-success';
  cm.textContent = '合同生成并保存记录成功';
}

/* ---------- 合同记录列表（含编辑与删除） ---------- */
function fetchContracts(){
  const clientName = clean(document.getElementById('filterContractClient').value || '');
  const providerName = clean(document.getElementById('filterContractProvider').value || '');
  const orderId = document.getElementById('filterContractOrderId').value;
  const date = document.getElementById('filterContractDate').value;
  const filtered = (appData.contracts || []).filter(c =>
    (!clientName || c.client_name.toLowerCase().includes(clientName.toLowerCase())) &&
    (!providerName || c.provider_name.toLowerCase().includes(providerName.toLowerCase())) &&
    (!orderId || c.order_id === parseInt(orderId)) &&
    (!date || (c.created_at_iso && c.created_at_iso.startsWith(date)))
  );
  const tbody = document.getElementById('contractTable');
  tbody.innerHTML = '';
  filtered.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.order_id}</td>
      <td>${c.client_name}</td>
      <td>${c.provider_name}</td>
      <td>${c.service_type}</td>
      <td>${c.contract_type}</td>
      <td>${formatLocal(c.created_at_iso)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="generateContract(${c.order_id}, '${c.contract_type}')">重新生成</button>
        <button class="btn btn-sm btn-secondary" onclick="editContract(${c.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteContract(${c.id})">删除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function editContract(contractId){
  const c = appData.contracts.find(x=>x.id===contractId);
  if(!c) return alert('合同不存在');
  const newClient = prompt('客户姓名', c.client_name);
  if(newClient===null) return;
  c.client_name = clean(newClient);
  const newProvider = prompt('团队名称', c.provider_name);
  if(newProvider===null) return;
  c.provider_name = clean(newProvider);
  logAction(`编辑合同: ${contractId}`, sessionStorage.getItem('currentUser'));
  fetchContracts();
}

function deleteContract(contractId){
  if(!confirm(`确认删除合同 ${contractId} ?`)) return;
  appData.contracts = appData.contracts.filter(c=>c.id!==contractId);
  logAction(`删除合同: ${contractId}`, sessionStorage.getItem('currentUser'));
  fetchContracts();
  renderStatistics();
}

/* ---------- 导出（全量 JSON 快照） ---------- */
function exportData(){
  const now = new Date();
  const filename = `goaoxor_data_${formatTimestampForFilename(now)}.json`;
  const snapshot = JSON.stringify(appData, null, 2);
  const blob = new Blob([snapshot], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
  logAction('导出数据快照', sessionStorage.getItem('currentUser'));
  alert('数据下载成功：' + filename);
}

/* ---------- 导出统计 CSV（示例） ---------- */
function exportSnapshotCSV(){
  // 以日为单位导出 orders count + income
  const series = buildDailySeries();
  // CSV header
  const rows = [['date','orders','income']];
  series.dates.forEach((d,i)=>{
    rows.push([d, series.orders[i], series.income[i].toFixed(2)]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const name = `goaoxor_stats_${formatTimestampForFilename(new Date())}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ---------- 统计：按天构建 series ---------- */
function buildDailySeries(days = 30){
  // collect orders by ISO date (YYYY-MM-DD)
  const now = new Date();
  const msPerDay = 24*3600*1000;
  const dateMap = new Map();
  // initialize last N days
  for(let i=days-1;i>=0;i--){
    const d = new Date(now.getTime() - i*msPerDay);
    const key = d.toISOString().slice(0,10);
    dateMap.set(key, {orders:0, income:0});
  }
  (appData.orders || []).forEach(o=>{
    if(!o.created_at_iso) return;
    const key = o.created_at_iso.slice(0,10);
    if(!dateMap.has(key)) {
      // optionally include earlier dates by expanding map (but keep last N days)
      return;
    }
    dateMap.get(key).orders += 1;
    dateMap.get(key).income += (Number(o.client_fee || 0) + Number(o.provider_fee || 0));
  });
  const dates = Array.from(dateMap.keys());
  const orders = dates.map(k=>dateMap.get(k).orders);
  const income = dates.map(k=>dateMap.get(k).income);
  return { dates, orders, income };
}

/* ---------- Chart.js 绘制 ---------- */
function renderStatistics(){
  const ctx = document.getElementById('trendChart').getContext('2d');
  const series = buildDailySeries(30);
  const labels = series.dates.map(d => d);
  const dataOrders = series.orders;
  const dataIncome = series.income;

  if(trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '每日订单数', data: dataOrders, yAxisID:'y', tension:0.3, fill:false },
        { label: '每日收入 (USD)', data: dataIncome, yAxisID:'y1', tension:0.3, fill:false }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode:'index', intersect:false },
      stacked: false,
      scales: {
        y: { type: 'linear', display: true, position: 'left' },
        y1: { type: 'linear', display: true, position: 'right',
              grid: { drawOnChartArea: false } }
      },
      plugins: { legend: { position: 'top' } }
    }
  });
}

/* ---------- 导航与页面切换 ---------- */
function showSection(section){
  const sections = document.querySelectorAll('.section');
  sections.forEach(s => { s.style.display = (s.id === section) ? 'block' : 'none'; });
  // sync sidebar active button
  document.querySelectorAll('#sidebar .nav-btn').forEach(b => b.classList.remove('active'));
  const map = {
    dashboard: 'navDashboard',
    orderDiv: 'navOrder',
    orderRecordDiv: 'navOrderRecord',
    contractDiv: 'navContract',
    contractRecordDiv: 'navContractRecord',
    statsDiv: 'navStats',
    adminDiv: 'navAdmin',
    changePasswordDiv: 'navChange'
  };
  const btnId = map[section] || 'navDashboard';
  const btn = document.getElementById(btnId);
  if(btn) btn.classList.add('active');

  // special fetch calls
  if(section === 'orderRecordDiv') fetchOrders();
  if(section === 'contractRecordDiv') fetchContracts();
  if(section === 'adminDiv') fetchAdmins();
  if(section === 'statsDiv') renderStatistics();
}

/* sidebar bindings */
document.getElementById('navDashboard').addEventListener('click', ()=> showSection('dashboard'));
document.getElementById('navOrder').addEventListener('click', ()=> showSection('orderDiv'));
document.getElementById('navOrderRecord').addEventListener('click', ()=> showSection('orderRecordDiv'));
document.getElementById('navContract').addEventListener('click', ()=> showSection('contractDiv'));
document.getElementById('navContractRecord').addEventListener('click', ()=> showSection('contractRecordDiv'));
document.getElementById('navStats').addEventListener('click', ()=> showSection('statsDiv'));
document.getElementById('navAdmin').addEventListener('click', ()=> showSection('adminDiv'));
document.getElementById('navChange').addEventListener('click', ()=> showSection('changePasswordDiv'));

/* 导出并登出 */
document.getElementById('navLogout').addEventListener('click', ()=>{
  exportData();
  sessionStorage.removeItem('currentUser');
  document.getElementById('mainDiv').style.display = 'none';
  document.getElementById('loginDiv').style.display = 'flex';
  document.getElementById('loginMsg').textContent = '';
});

/* ---------- 合同表单提交 ---------- */
document.getElementById('contractForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const orderId = parseInt(document.getElementById('contractOrderId').value || 0);
  const clientName = clean(document.getElementById('contractClientName').value);
  const providerName = clean(document.getElementById('contractProviderName').value);
  const projectValue = parseFloat(document.getElementById('contractProjectValue').value);
  const type = document.getElementById('contractType').value;
  const serviceType = document.getElementById('contractServiceType').value;
  generateContract(orderId || 0, type, clientName, providerName, projectValue, serviceType);
  document.getElementById('contractForm').reset();
});

/* ---------- 时间显示 ---------- */
function updateTime(){ document.getElementById('currentTime').textContent = new Date().toLocaleString(); }
setInterval(updateTime, 1000);

/* ---------- 页面初始化 ---------- */
window.onload = async ()=>{
  await initializeDefaultData();
  // 如果 session 存在 currentUser，直接进入后台
  const current = sessionStorage.getItem('currentUser');
  if(current && appData.admins.find(a => a.username === current)){
    document.getElementById('loginDiv').style.display = 'none';
    document.getElementById('mainDiv').style.display = 'flex';
    document.getElementById('currentUser').textContent = current;
    const admin = appData.admins.find(a=>a.username===current);
    if(admin) document.getElementById('lastLogin').textContent = admin.lastLogin || '未记录';
    fetchOrders(); fetchContracts(); fetchAdmins(); renderStatistics();
  } else {
    document.getElementById('loginDiv').style.display = 'flex';
    document.getElementById('mainDiv').style.display = 'none';
  }
  updateTime();
};
