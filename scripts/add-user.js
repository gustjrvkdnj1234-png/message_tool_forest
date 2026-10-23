'use strict';

// 사용법: npm run add-user -- <닉네임> <비밀번호>
// users.json에 계정을 추가(이미 있으면 비밀번호 교체). 비밀번호는 scrypt 해시로만 저장된다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [nick, password] = process.argv.slice(2);
if (!nick || !password) {
  console.error('사용법: npm run add-user -- <닉네임> <비밀번호>');
  process.exit(1);
}
if (!/^[\w가-힣-]{2,16}$/.test(nick)) {
  console.error('닉네임은 2~16자의 한글/영문/숫자/_/- 만 가능합니다.');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'users.json');
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { users: [] };

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
const entry = { nick, salt: salt.toString('hex'), hash: hash.toString('hex') };

const idx = data.users.findIndex((u) => u.nick === nick);
if (idx >= 0) data.users[idx] = entry;
else data.users.push(entry);

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`${idx >= 0 ? '갱신' : '추가'}: ${nick} (서버를 재시작해야 반영됩니다)`);
