/* RETINA STT: phrase table. Maps Thai and English phrases from a finished
   Call Transcript line to one fixed list of English chips (ADR 0002). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var PHRASES = [
    { chip: 'Motorcycle vs pole', type: 'moi',
      en: ['motorcycle hit a pole', 'motorbike hit a pole', 'motorcycle crashed into a pole', 'bike hit a pole'],
      th: ['มอเตอร์ไซค์ชนเสา', 'มอไซค์ชนเสา', 'รถจักรยานยนต์ชนเสา'] },
    { chip: 'No helmet', type: 'moi',
      en: ['no helmet', 'not wearing a helmet', 'without a helmet'],
      th: ['ไม่ใส่หมวก', 'ไม่สวมหมวกกันน็อก', 'ไม่ได้ใส่หมวกกันน็อค'] },
    { chip: 'High-energy impact', type: 'moi',
      en: ['high speed', 'flew off'],
      th: ['ความเร็วสูง', 'ขับเร็วมาก', 'กระเด็น'] },
    { chip: 'Unconscious', type: 'noi',
      en: ['unconscious', 'not responding', 'passed out'],
      th: ['หมดสติ', 'ไม่รู้สึกตัว', 'ไม่ตอบสนอง'] },
    { chip: 'Not breathing', type: 'noi',
      en: ['not breathing', 'stopped breathing'],
      th: ['ไม่หายใจ', 'หยุดหายใจ'] },
    { chip: 'Head bleeding', type: 'noi',
      en: ['bleeding from his head', 'bleeding from her head', 'bleeding from the head', 'head is bleeding'],
      th: ['เลือดออกที่หัว', 'เลือดออกจากศีรษะ', 'หัวแตก'] },
    { chip: 'Chest pain', type: 'noi',
      en: ['chest pain', 'pain in his chest', 'pain in her chest'],
      th: ['เจ็บหน้าอก', 'แน่นหน้าอก'] },
    { chip: 'Food allergy', type: 'noi',
      en: ['food allergy', 'allergic to food', 'allergic to seafood', 'allergic to shrimp', 'allergic to peanuts', 'allergic to nuts'],
      th: ['แพ้อาหาร', 'แพ้กุ้ง', 'แพ้ถั่ว'] },
    { chip: 'Stroke signs', type: 'noi',
      en: ['face drooping', 'slurred speech'],
      th: ['ปากเบี้ยว', 'พูดไม่ชัด', 'แขนขาอ่อนแรง'] }
  ];

  /* A phrase is not suggested when the text right before it ends with one of these. */
  var EN_NEGATIONS = ['not ', 'no longer ', 'no ', "wasn't ", "isn't ", "aren't ", "weren't ", 'never ', 'denies ', 'without '];
  var TH_NEGATIONS = ['ไม่', 'ไม่ได้', 'ไม่มี', 'ไม่ได้มี', 'ยังไม่'];

  function isWordChar(c) { return /[a-z0-9]/.test(c || ''); }

  /* True when `phrase` occurs in `text` at least once without a negation right before it. */
  function hasEnglish(text, phrase) {
    for (var i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) {
      if (isWordChar(text[i - 1]) || isWordChar(text[i + phrase.length])) continue;
      var before = text.slice(0, i);
      if (EN_NEGATIONS.some(function (n) { return before.slice(-n.length) === n; })) continue;
      return true;
    }
    return false;
  }

  function hasThai(text, phrase) {
    for (var i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) {
      var before = text.slice(0, i);
      if (TH_NEGATIONS.some(function (n) { return before.slice(-n.length) === n; })) continue;
      return true;
    }
    return false;
  }

  function suggestChips(text) {
    var base = String(text || '').normalize('NFC').toLowerCase().replace(/[‘’]/g, "'");
    var en = base.replace(/\s+/g, ' ');
    var th = base.replace(/\s+/g, '');
    return PHRASES.filter(function (p) {
      return p.en.some(function (ph) { return hasEnglish(en, ph); }) || p.th.some(function (ph) { return hasThai(th, ph); });
    }).map(function (p) { return { chip: p.chip, type: p.type }; });
  }

  return { PHRASES: PHRASES, suggestChips: suggestChips };
});
