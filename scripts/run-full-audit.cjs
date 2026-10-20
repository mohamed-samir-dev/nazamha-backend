const fs = require('fs');
const path = require('path');
const puppeteer = require('c:/Users/loutf/OneDrive/Desktop/Student-track-me/backend/node_modules/puppeteer');

const root = path.resolve(__dirname, '../../reports/audit-comprehensive');
fs.mkdirSync(root, { recursive: true });

async function run() {
  const qa = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../reports/students-audit-runtime/session.json'), 'utf8'));
  console.log('Starting full audit with QA account:', qa.email);

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const consoleLogs = [];
  const networkErrors = [];
  const metricsReport = {};

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleLogs.push({ type: msg.type(), text: msg.text().slice(0, 300) });
    }
  });

  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      networkErrors.push({ url: res.url(), status: res.status() });
    }
  });

  // Login
  console.log('Logging in...');
  await page.goto('http://localhost:3000/teacher/login', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('input[type=email]', qa.email);
  await page.type('input[type=password]', qa.password);
  await page.click('button[type=submit]');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  async function measurePage(url, pageKey) {
    console.log(`\n================ Measuring: ${url} ================`);
    const pageErrors = [];
    const pageNetwork = [];
    
    const errListener = e => pageErrors.push(e.message);
    page.on('pageerror', errListener);

    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    const loadTimeMs = Date.now() - startTime;

    const perfMetrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
      return {
        dnsMs: nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : 0,
        tcpMs: nav ? Math.round(nav.connectEnd - nav.connectStart) : 0,
        ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : 0,
        domInteractiveMs: nav ? Math.round(nav.domInteractive) : 0,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
        domCompleteMs: nav ? Math.round(nav.domComplete) : 0,
        fcpMs: Math.round(fcp),
        domNodes: document.querySelectorAll('*').length
      };
    });

    await page.screenshot({ path: path.join(root, `${pageKey}.png`), fullPage: true });

    page.off('pageerror', errListener);

    return {
      url,
      loadTimeMs,
      perfMetrics,
      pageErrors
    };
  }

  // 1. /teacher (Dashboard)
  metricsReport.teacherDashboard = await measurePage('http://localhost:3000/teacher', '01-teacher-dashboard');
  
  // Test Dashboard interactions
  console.log('Testing Dashboard buttons and modals...');
  const dashInteractions = {};
  
  // Test Refresh button
  const refreshBtn = await page.$('button[aria-busy]');
  if (refreshBtn) {
    await refreshBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    dashInteractions.refreshTested = true;
  }

  // Test Unpaid Modal button
  const unpaidCardBtn = await page.$('button[style*="cursor"]');
  if (unpaidCardBtn) {
    await unpaidCardBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    const modalVisible = await page.$eval('.fixed', el => !!el).catch(() => false);
    dashInteractions.unpaidModalOpened = modalVisible;
    await page.screenshot({ path: path.join(root, '01-unpaid-modal.png') });
    // Close modal
    const closeBtn = await page.$('button[aria-label="إغلاق"], .fixed button');
    if (closeBtn) await closeBtn.click().catch(() => {});
    await new Promise(r => setTimeout(r, 800));
  }

  metricsReport.teacherDashboard.interactions = dashInteractions;

  // 2. /teacher/groups
  metricsReport.teacherGroups = await measurePage('http://localhost:3000/teacher/groups', '02-teacher-groups');
  
  console.log('Testing Groups interactions...');
  const groupsInteractions = {};

  // Calendar sync modal
  const syncBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.innerText.includes('مزامنة مع التقويم') || x.innerText.includes('التقويم'));
    if (b) { b.click(); return true; }
    return false;
  });
  await new Promise(r => setTimeout(r, 1500));
  groupsInteractions.calendarModalOpened = await page.$eval('.modal-overlay, [role="dialog"]', () => true).catch(() => false);
  await page.screenshot({ path: path.join(root, '02-calendar-modal.png') });
  // Close calendar modal
  await page.evaluate(() => {
    const closeBtn = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('إغلاق'));
    if (closeBtn) closeBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Create Group Modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('مجموعة جديدة') || x.innerText.includes('جديدة'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  groupsInteractions.createGroupModalOpened = await page.$eval('[role="dialog"], .modal-overlay', () => true).catch(() => false);
  await page.screenshot({ path: path.join(root, '02-create-group-modal.png') });

  // Test form validation: submit empty
  await page.evaluate(() => {
    const submit = document.querySelector('form button[type="submit"]');
    if (submit) submit.click();
  });
  await new Promise(r => setTimeout(r, 800));
  groupsInteractions.emptySubmitValidation = await page.evaluate(() => {
    const err = document.querySelector('.form-error, [role="alert"]');
    return err ? err.innerText : 'none';
  });

  // Close create modal
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const x = document.querySelector('.modal-overlay button');
    if (x) x.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Test Switch View (Schedule vs Cards)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const schedBtn = btns.find(b => b.innerText.includes('جدول'));
    if (schedBtn) schedBtn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  groupsInteractions.scheduleViewLoaded = await page.$eval('table', () => true).catch(() => false);
  await page.screenshot({ path: path.join(root, '02-groups-schedule-view.png') });

  // Switch back to Cards
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cardsBtn = btns.find(b => b.innerText.includes('كروت'));
    if (cardsBtn) cardsBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  metricsReport.teacherGroups.interactions = groupsInteractions;

  // 3. /teacher/students
  metricsReport.teacherStudents = await measurePage('http://localhost:3000/teacher/students', '03-teacher-students');
  
  console.log('Testing Students interactions...');
  const studentsInteractions = {};

  // Accordion guide toggle
  const detailsOpened = await page.evaluate(() => {
    const det = document.querySelector('details');
    if (det) { det.open = !det.open; return det.open; }
    return false;
  });
  studentsInteractions.accordionToggled = detailsOpened;

  // Payment Scan Modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('سكان الدفع'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  studentsInteractions.paymentScanModalOpened = await page.$eval('.modal-overlay, .payment-scan-modal', () => true).catch(() => false);
  await page.screenshot({ path: path.join(root, '03-payment-scan-modal.png') });
  // Close Payment Scan
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const close = document.querySelector('.modal-overlay button, button[aria-label="Close"]');
    if (close) close.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Auto-suspend modal
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('إيقاف المتأخرين'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1200));
  studentsInteractions.suspendModalOpened = await page.$eval('.fixed', () => true).catch(() => false);
  await page.screenshot({ path: path.join(root, '03-suspend-modal.png') });
  // Cancel suspend
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('إلغاء'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Test Search Debounce
  await page.type('input[placeholder*="ابحث بالاسم"]', 'طالب');
  await new Promise(r => setTimeout(r, 1500));
  studentsInteractions.searchResultsCount = await page.$$eval('.student-row', els => els.length).catch(() => 0);
  // Clear search
  await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="ابحث بالاسم"]');
    if (inp) {
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  // Test Selection Checkbox
  const checkboxResult = await page.evaluate(() => {
    const firstCheck = document.querySelector('.row-check-btn');
    if (firstCheck) {
      firstCheck.click();
      return true;
    }
    return false;
  });
  await new Promise(r => setTimeout(r, 500));
  studentsInteractions.selectionActive = await page.$eval('.students-page-container', el => el.innerText.includes('تم تحديد 1 طالب')).catch(() => false);

  metricsReport.teacherStudents.interactions = studentsInteractions;

  // 4. /teacher/students/print-qr
  metricsReport.teacherPrintQR = await measurePage('http://localhost:3000/teacher/students/print-qr', '04-teacher-print-qr');
  
  console.log('Testing Print QR interactions...');
  const qrInteractions = {};

  // Card count and rendered QR count
  qrInteractions.renderedCards = await page.$$eval('[data-student-id]', els => els.length);
  qrInteractions.svgQrCount = await page.$$eval('svg', els => els.length);

  // Test Selection in QR page
  await page.evaluate(() => {
    const firstCardCheck = document.querySelector('[role="checkbox"]');
    if (firstCardCheck) firstCardCheck.click();
  });
  await new Promise(r => setTimeout(r, 500));
  qrInteractions.selectedHeaderUpdated = await page.evaluate(() => {
    return document.body.innerText.includes('1 محددة') || document.body.innerText.includes('طباعة المحددة');
  });

  // Test Select All on current page checkbox
  await page.evaluate(() => {
    const selectAll = document.querySelector('#select-all');
    if (selectAll) selectAll.click();
  });
  await new Promise(r => setTimeout(r, 500));
  qrInteractions.selectAllTriggered = await page.evaluate(() => {
    return document.body.innerText.includes('محددة');
  });
  await page.screenshot({ path: path.join(root, '04-qr-cards-selected.png') });

  // Test CSV export function call safely
  const csvExportButton = await page.$('button[disabled]'); // check if disabled logic is healthy
  qrInteractions.hasCsvButton = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('تصدير'));
  });

  metricsReport.teacherPrintQR.interactions = qrInteractions;

  // Global console errors and network summary
  metricsReport.consoleLogs = consoleLogs;
  metricsReport.networkErrors = networkErrors;

  fs.writeFileSync(path.join(root, 'audit-results.json'), JSON.stringify(metricsReport, null, 2));
  console.log('\nAudit complete! Saved results to reports/audit-comprehensive/audit-results.json');

  await browser.close();
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
