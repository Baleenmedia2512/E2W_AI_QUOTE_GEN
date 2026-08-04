import { hyphenateLongWord, hyphenateLongWords } from './hyphenateLongWords';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(hyphenateLongWord('short') === 'short', 'short unchanged');
assert(hyphenateLongWord('abcdefghijklm') === 'abcdefghijklm', 'exactly 13 unchanged');
assert(
  hyphenateLongWord('periyanayakanpalayam') === 'periyanayakan-\n-palayam',
  '19-char place name',
);
assert(
  hyphenateLongWord('Periyanayakanpalayam') === 'Periyanayakan-\n-palayam',
  'preserves case',
);
assert(
  hyphenateLongWord('abcdefghijklmnopqrstuvwxyz0123') ===
    'abcdefghijklm-\n-nopqrstuvwxyz-\n-0123',
  '30-char triple break',
);

assert(
  hyphenateLongWords('Hoarding Coimbatore Periyanayakanpalayam Bridge') ===
    'Hoarding Coimbatore Periyanayakan-\n-palayam Bridge',
  'only long word breaks',
);
assert(
  hyphenateLongWords('bus-full-branding-chennai') === 'bus-full-branding-chennai',
  'kebab segments under 13 untouched',
);
assert(
  hyphenateLongWords('bus-periyanayakanpalayam-chennai') ===
    'bus-periyanayakan-\n-palayam-chennai',
  'long segment inside kebab',
);

console.log('hyphenateLongWords.test.ts: all passed');
