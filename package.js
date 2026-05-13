// package.js
const fs = require('fs');
const archiver = require('archiver');
const path = require('path');

const output = fs.createWriteStream(path.join(__dirname, 'RefinedNowPlaying.plugin'));
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => console.log('打包完成，扩展名已改为 .plugin'));

archive.pipe(output);
archive.directory('dist/', false); // 将dist内部文件打包
archive.finalize();