const { google } = require('googleapis');
console.log('Available APIs:');
console.log(Object.keys(google).filter(k => k.includes('business')));
