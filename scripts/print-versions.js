'use strict';
const { app } = require('electron');
app.whenReady().then(() => {
  console.log('electron=' + process.versions.electron);
  console.log('chrome=' + process.versions.chrome);
  app.quit();
});
