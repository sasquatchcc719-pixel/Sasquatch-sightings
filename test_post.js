const fetch = require('node-fetch');
async function run() {
  const res = await fetch('http://localhost:3000/api/admin/ops/estimates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    })
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}
run();
