import {inflateSync} from 'node:zlib';

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const invalid=()=>{throw new Error('Invalid or oversized PNG image');};

// Check every chunk and the decoded scanline structure, including Adam7.
// Limits bound memory even when the exported drawing has extreme dimensions.
export function validatePng(data){
  if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))invalid();
  let offset=8,width,height,depth,channels,interlace,ended=false;const compressed=[];
  while(offset+12<=data.length){
    const size=data.readUInt32BE(offset),end=offset+12+size;
    if(end>data.length)invalid();
    const type=data.toString('ascii',offset+4,offset+8),bytes=data.subarray(offset+8,offset+8+size);
    if(crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))invalid();
    if(offset===8&&type!=='IHDR')invalid();
    if(type==='IHDR'){
      if(width||size!==13)invalid();
      width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);depth=bytes[8];interlace=bytes[12];
      const color=bytes[9],allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      channels={0:1,2:3,3:1,4:2,6:4}[color];
      if(!width||!height||width>65535||height>65535||!allowed[color]?.includes(depth)||bytes[10]||bytes[11]||interlace>1)invalid();
    }else if(type==='IDAT')compressed.push(bytes);
    else if(type==='IEND'){if(size||end!==data.length)invalid();ended=true;break;}
    offset=end;
  }
  if(!ended||!compressed.length)invalid();
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{
    const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));
    return {count:w?h:0,bytes:Math.ceil(w*channels*depth/8)+1};
  });
  const expected=rows.reduce((total,row)=>total+row.count*row.bytes,0);
  if(expected>256*1024*1024)invalid();
  const decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});
  if(decoded.length!==expected)invalid();
  let scan=0;for(const row of rows)for(let i=0;i<row.count;i++){if(decoded[scan]>4)invalid();scan+=row.bytes;}
  return {width,height};
}
