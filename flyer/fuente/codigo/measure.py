import sys,json
from fontTools.ttLib import TTFont
F={'black':'fonts/ArchivoBlack.ttf','400':'fonts/Archivo-400.ttf','500':'fonts/Archivo-500.ttf','700':'fonts/Archivo-700.ttf','800':'fonts/Archivo-800.ttf','pop':'fonts/Poppins-600.ttf'}
out={}
for k,f in F.items():
  t=TTFont(f); cm=t.getBestCmap(); hm=t['hmtx']; u=t['head'].unitsPerEm
  out[k]={'u':u,'w':{chr(c):hm[g][0] for c,g in cm.items() if c<0x2200}}
json.dump(out,open('metrics.json','w'))
