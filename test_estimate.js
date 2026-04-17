const http = require('http');

const data = JSON.stringify({
  appointment_date: '2026-04-17',
  start_time: '09:00',
  customer: {
    first_name: 'New',
    last_name: 'Estimate',
    phone: '+10000000000',
    email: null,
    business_name: null,
  },
  address: {
    label: 'Service Address',
    street_1: 'TBD',
    city: 'TBD',
    state: 'CO',
    zip_code: '00000',
  },
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/ops/estimates',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      // Need a cookie or auth? The user is logged in the browser. 
      // But maybe API requires auth. I can just read log file if there is one.
    },
  },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => console.log('Status', res.statusCode, 'Body:', body));
  }
);
req.on('error', console.error);
req.write(data);
req.end();
