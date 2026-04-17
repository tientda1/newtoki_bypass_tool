const { execSync } = require('child_process');
try {
  const r = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve', {encoding:'utf8'});
  console.log('HKLM:', r);
} catch(e) {}
try {
  const r2 = execSync('reg query "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve', {encoding:'utf8'});
  console.log('HKCU:', r2);
} catch(e2) { console.log('NOT FOUND in registry'); }
