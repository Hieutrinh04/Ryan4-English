import { NextResponse } from "next/server";

type DictionaryEntry = { word?:string; phonetic?:string; phonetics?:{text?:string}[]; meanings?:{partOfSpeech?:string;definitions?:{definition?:string;example?:string}[]}[] };

const verifiedVietnamese:Record<string,string>={
  comfortable:"thoải mái; dễ chịu",
  uncomfortable:"không thoải mái; khó chịu",
};

function topicFor(term:string, definition:string, meaning:string) {
  const text=`${term} ${definition} ${meaning}`.toLowerCase();
  const groups:[string,string[]][]=[
    ["Công nghệ",["computer","software","data","digital","internet","program","system","device","code"]],
    ["Cảm xúc",["feel","emotion","happy","sad","angry","fear","love","kind","mood"]],
    ["Động vật",["animal","bird","mammal","fish","insect","creature"]],
    ["Khoa học",["science","chemical","physical","energy","research","invent","biology"]],
    ["Công việc",["work","business","company","manage","office","career","project"]],
    ["Giao tiếp",["speak","say","talk","communicate","language","conversation","express"]],
    ["Đời sống",["daily","home","family","food","travel","life","person"]],
  ];
  return groups.find(([,keys])=>keys.some(key=>text.includes(key)))?.[0] ?? "Từ vựng chung";
}

async function lookupEntries(word:string):Promise<DictionaryEntry[]> {
  try{
    const response=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,{headers:{Accept:"application/json"}});
    if(!response.ok) return [];
    const entries=await response.json() as DictionaryEntry[];
    return Array.isArray(entries)?entries:[];
  }catch{ return []; }
}

async function lookupEntry(word:string):Promise<DictionaryEntry|undefined> {
  return (await lookupEntries(word)).find(item=>item.word?.trim().toLowerCase()===word);
}

// Bản dịch bị coi là hỏng khi rỗng hoặc trả về nguyên văn tiếng Anh.
function usableTranslation(text:string, source:string) {
  const value=text.trim();
  return value&&value.toLowerCase()!==source.trim().toLowerCase()?value:"";
}

// Nguồn dịch chính: chất lượng tốt hơn hẳn với từ đơn (MyMemory khớp nhầm "blink" thành "block").
// Đây là endpoint không chính thức, không cần khoá, nên luôn có nguồn dự phòng phía dưới.
async function translateViaGoogle(text:string) {
  try{
    const response=await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`);
    if(!response.ok) return "";
    const data=await response.json() as unknown;
    if(!Array.isArray(data)||!Array.isArray(data[0])) return "";
    const joined=(data[0] as unknown[]).map(part=>(Array.isArray(part)?String(part[0]??""):"")).join("");
    return usableTranslation(joined,text);
  }catch{ return ""; }
}

async function translateViaMyMemory(text:string) {
  try{
    const response=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`);
    const translated=await response.json() as {responseData?:{translatedText?:string}};
    return usableTranslation(translated.responseData?.translatedText??"",text);
  }catch{ return ""; }
}

// Bỏ phần ghi nguồn ở cuối câu trích dẫn, ví dụ "… ― Gary Cook".
function cleanExample(raw:string) {
  return raw.replace(/\s*[―—–]{1,2}\s*[^.!?]*$/,"").replace(/\s+/g," ").trim();
}

// Từ điển hay giấu câu ví dụ ở các nghĩa phía sau, không phải nghĩa đầu tiên.
// Chỉ nhận câu hoàn chỉnh có chứa chính từ đang học, để không lấy phải mẩu cụm rời rạc.
type Meaning=NonNullable<DictionaryEntry["meanings"]>[number];
function pickDictionaryExample(entries:DictionaryEntry[], word:string, chosenMeaning?:Meaning, preferredPart?:string) {
  const stem=word.replace(/(ies|es|s)$/,"");
  const scored=entries
    .flatMap(entry=>(entry.meanings??[]).flatMap(meaning=>(meaning.definitions??[]).map(definition=>({text:definition.example?cleanExample(definition.example):"",part:meaning.partOfSpeech??"",sameMeaning:meaning===chosenMeaning}))))
    .filter(item=>item.text)
    .map(item=>{
      const lower=item.text.toLowerCase();
      const exact=lower.includes(word);
      const viaStem=stem.length>=3&&lower.includes(stem);
      const count=item.text.split(/\s+/).length;
      const wholeSentence=/^["'“]?[A-Z]/.test(item.text)&&/[.!?]["'”]?$/.test(item.text);
      if(!wholeSentence) return null;
      if(!exact&&!(viaStem&&count>=6)) return null;
      if(count<5||count>28) return null;
      // Cùng nghĩa với định nghĩa đang hiển thị được ưu tiên cao nhất, để định nghĩa và ví dụ không lệch nghĩa nhau.
      const score=(item.sameMeaning?4:0)+(exact?3:2)+(preferredPart&&item.part===preferredPart?2:0)+(count<=18?1:0);
      return {text:item.text,score};
    })
    .filter((item):item is {text:string;score:number}=>item!==null)
    .sort((a,b)=>b.score-a.score);
  return scored[0]?.text;
}

// Không có câu ví dụ thật thì dùng khung câu ghi chú học tập, chọn theo từ để mỗi từ một khung khác nhau.
const studyFrames:[string,string][]=[
  ['The word "W" came up twice in today\'s reading.','Từ “W” xuất hiện hai lần trong bài đọc hôm nay.'],
  ['I wrote "W" in my notebook so I would not forget it.','Tôi đã ghi “W” vào sổ tay để khỏi quên.'],
  ['Our teacher asked us to use "W" in a sentence.','Cô giáo yêu cầu chúng tôi đặt câu với “W”.'],
  ['I heard "W" in a podcast on the way to work.','Tôi nghe thấy “W” trong một podcast trên đường đi làm.'],
  ['"W" is the word I want to remember this week.','“W” là từ tôi muốn nhớ trong tuần này.'],
  ['I looked up "W" after meeting it in an article.','Tôi tra “W” sau khi gặp nó trong một bài báo.'],
  ['My friend used "W" and I had to ask what it meant.','Bạn tôi dùng từ “W” và tôi đã phải hỏi nó nghĩa là gì.'],
  ['I met "W" for the first time in a novel last night.','Tối qua tôi gặp “W” lần đầu trong một cuốn tiểu thuyết.'],
  ['The teacher wrote "W" on the board and explained it slowly.','Cô giáo viết “W” lên bảng và giải thích chậm rãi.'],
  ['I keep forgetting "W", so I put it on a sticky note.','Tôi cứ quên “W” nên đã dán nó lên một tờ giấy nhớ.'],
  ['"W" appeared three times in the same chapter.','“W” xuất hiện ba lần trong cùng một chương.'],
  ['I practised saying "W" out loud until it felt natural.','Tôi tập đọc to “W” cho đến khi thấy tự nhiên.'],
  ['A colleague explained what "W" means during our meeting.','Một đồng nghiệp đã giải thích “W” nghĩa là gì trong cuộc họp.'],
];
function studyFrameFor(word:string) {
  let hash=0;
  for(const character of word) hash=(hash*31+character.charCodeAt(0))>>>0;
  const [en,vi]=studyFrames[hash%studyFrames.length];
  return {example:en.replaceAll("W",word),exampleVi:vi.replaceAll("W",word)};
}

function phoneticOf(entry?:DictionaryEntry) {
  const raw=entry?.phonetic||entry?.phonetics?.find(item=>item.text)?.text||"";
  return raw.replace(/^\/|\/$/g,"").trim();
}

// Từ nối/mạo từ không mang nghĩa riêng nên bỏ khỏi phần giải nghĩa từng từ.
const functionWords=new Set(["a","an","the","of","to","in","on","at","for","and","or","but","is","are","am","be","been","with","as","that","this","it","its","by","from","not","no","so","up","out","off","over","into","than","then","there","here","he","she","they","we","you","i","my","your","his","her"]);

export async function POST(request:Request) {
  const { term }=await request.json() as {term?:string};
  const word=term?.trim().toLowerCase().replace(/\s+/g," ");
  if(!word||!/^[a-z][a-z'\- ]{0,59}$/i.test(word)) return NextResponse.json({error:"Chỉ hỗ trợ chữ cái, dấu nháy và gạch nối."},{status:400});
  const isPhrase=word.includes(" ");
  const translate=async(text:string)=>(await translateViaGoogle(text))||(await translateViaMyMemory(text));
  try{
    // Từ điển chỉ có mục từ cho từ đơn và một vài cụm cố định.
    const entries=await lookupEntries(word);
    const entry=entries.find(item=>item.word?.trim().toLowerCase()===word);
    if(!entry&&!isPhrase) return NextResponse.json({error:"Không tìm thấy từ trong từ điển."},{status:404});
    const preferredPart=/able$|ible$|ful$|less$|ous$|ive$|al$|ic$|y$/.test(word)?"adjective":undefined;
    const meaning=(preferredPart&&entry?.meanings?.find(item=>item.partOfSpeech===preferredPart))||entry?.meanings?.[0];
    const definition=meaning?.definitions?.[0];
    const meaningVi=verifiedVietnamese[word]||await translate(word);
    if(!entry){
      // Cụm từ không có mục từ riêng: dựng IPA và phần giải nghĩa từ dữ liệu thật của từng từ thành phần.
      const parts=word.split(" ");
      const partEntries=await Promise.all(parts.map(lookupEntry));
      const phonetics=partEntries.map(phoneticOf);
      const ipa=phonetics.every(Boolean)?`/${phonetics.join(" ")}/`:"";
      const glossary=parts
        .map((part,index)=>{
          if(functionWords.has(part)) return "";
          const wordDefinition=partEntries[index]?.meanings?.[0]?.definitions?.[0]?.definition;
          return wordDefinition?`${part}: ${wordDefinition}`:"";
        })
        .filter(Boolean)
        .join("\n");
      // Dịch máy sẽ dịch luôn cụm từ trong ngoặc kép, làm mất chính thứ cần học — nên dựng sẵn cả câu tiếng Việt.
      const {example,exampleVi}=studyFrameFor(word);
      if(!meaningVi&&!glossary) return NextResponse.json({error:"Không tra được cụm từ này. Vui lòng nhập nội dung thủ công."},{status:404});
      return NextResponse.json({term:word,ipa,part_of_speech:"phrase",meaning_vi:meaningVi,definition_en:glossary,example,example_vi:exampleVi,topic:topicFor(word,glossary,meaningVi),partial:true,example_source:"template"});
    }
    const definitionEn=definition?.definition||`The meaning of ${word}.`;
    // Ưu tiên câu ví dụ thật trong từ điển; hết cách mới dùng khung câu ghi chú.
    const realExample=pickDictionaryExample(entries,word,meaning,preferredPart??meaning?.partOfSpeech);
    const frame=studyFrameFor(word);
    const example=realExample??frame.example;
    const exampleVi=realExample?await translate(realExample):frame.exampleVi;
    return NextResponse.json({term:word,ipa:entry.phonetic||entry.phonetics?.find(p=>p.text)?.text||"/…/",part_of_speech:meaning?.partOfSpeech||"",meaning_vi:meaningVi||definitionEn,definition_en:definitionEn,example,example_vi:exampleVi,topic:topicFor(word,definitionEn,meaningVi),partial:false,example_source:realExample?"dictionary":"template"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Không thể tự động điền từ."},{status:404});}
}
