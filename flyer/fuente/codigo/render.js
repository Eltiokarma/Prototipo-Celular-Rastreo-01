const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');
const f=process.argv[2], w=+(process.argv[3]||900), o=process.argv[4]||f.replace('.svg','.png');
const r=new Resvg(fs.readFileSync(f,'utf8'),{fitTo:{mode:'width',value:w},font:{fontFiles:fs.readdirSync('fonts').map(x=>'fonts/'+x),loadSystemFonts:false,defaultFontFamily:'Archivo'}});
fs.writeFileSync(o,r.render().asPng());
