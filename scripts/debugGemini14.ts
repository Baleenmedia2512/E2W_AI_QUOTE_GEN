const { loadProgressiveTestCatalog } = await import('../src/utils/progressiveChat.testCatalog');
const {
  resolveProgressiveText,
  detectCityInText,
  detectLocalityInText,
  detectDirectionInText,
} = await import('../src/chat/index');

const cat = await loadProgressiveTestCatalog();
const DB = cat.services;
console.log('geminiLabel', cat.labels.geminiLabel, 'geminiIsArea', cat.labels.geminiIsArea);
const text = 'I need hoarding in Chennai near Gemini Fly Over';
console.log('city', detectCityInText(text, DB));
console.log('locality', detectLocalityInText(text, DB));
console.log('direction', detectDirectionInText(text, DB));
// trace explicit area phrase logic
const m = text.match(
  /\b(?:near|around|nearby|close\s+to)\s+([a-z][a-z\s.-]*?)(?=$|[,.!?]|\s+\d|\s+(?:for|with|and)\b)/i,
);
console.log('explicitAreaPhrase', m?.[1]);
const r = resolveProgressiveText(text, DB, null, null);
console.log('step', r.step);
console.log('session', JSON.stringify({
  medium: r.session.medium,
  city: r.session.city,
  area: r.session.area,
  placeHint: r.session.placeHint,
  directionHint: r.session.directionHint,
}, null, 2));
console.log('botText', r.botText);
