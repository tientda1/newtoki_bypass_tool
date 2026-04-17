const c = require('./newtoki-cookies.json');
console.log('Total:', c.length, 'cookies');
c.forEach(x => console.log(' -', x.name.padEnd(30), '|', x.domain));
const cf = c.find(x => x.name === '__cf_clearance');
console.log('\n__cf_clearance:', cf ? 'FOUND ✓' : 'NOT FOUND ✗');
