require('dotenv').config();
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const C = process.env.CLOUDINARY_CLOUD_NAME;
const K = process.env.CLOUDINARY_API_KEY;
const S = process.env.CLOUDINARY_API_SECRET;

const filePath = process.argv[2] || 'C:/Users/LENOVO/Pictures/favicon.jpg';

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

console.log('Cloud:', C);
console.log('Key:', K);
console.log('Secret length:', S?.length);
console.log('Uploading:', filePath);
console.log('---');

const ts = Math.floor(Date.now() / 1000);
const toSign = 'folder=my-uploads&timestamp=' + ts;
const signature = crypto.createHash('sha1').update(toSign + S).digest('hex');

console.log('Timestamp:', ts);
console.log('Signature:', signature);
console.log('---');

const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
const fileData = fs.readFileSync(filePath);

const parts = [];
function textPart(name, value) {
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    'utf8'
  ));
}

textPart('api_key', K);
textPart('timestamp', ts);
textPart('signature', signature);
textPart('folder', 'my-uploads');

parts.push(Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="favicon.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
  'utf8'
));
parts.push(fileData);
parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

const body = Buffer.concat(parts);

const options = {
  hostname: 'api.cloudinary.com',
  path: `/v1_1/${C}/image/upload`,
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
};

const req = https.request(options, (res) => {
  let chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    console.log('HTTP STATUS:', res.statusCode);
    console.log('RESPONSE BODY:');
    console.log(text);
  });
});

req.on('error', (err) => {
  console.error('REQUEST ERROR:', err.message);
});

req.write(body);
req.end();