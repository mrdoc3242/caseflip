const fs=require('fs');
let h=fs.readFileSync('src/app.html','utf8');
h=h.replace('/*ENGINE*/',()=>fs.readFileSync('src/engine.js','utf8')).replace('/*GAMES*/',()=>fs.readFileSync('src/games.js','utf8')).replace('/*ART*/',()=>fs.readFileSync('src/art.js','utf8')).replace('/*APP*/',()=>(()=>{const a=fs.readFileSync('src/app.js','utf8').replace('/*IMAGES*/{}',fs.readFileSync('src/images.inline.json','utf8').trim());const k=a.lastIndexOf('})();');return a.slice(0,k)+fs.readFileSync('src/app_more.js','utf8')+fs.readFileSync('src/i18n.js','utf8')+'\nboot();\n})();\n';})());
fs.mkdirSync('dist',{recursive:true});
fs.writeFileSync('dist/caseflip.html',h);
// standalone deployable version with full doc skeleton
fs.writeFileSync('dist/index.html','<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+h.replace(/<style>/,'<style>body{margin:0}[hidden]{display:none!important}')+'</html>');
console.log('built', h.length);
