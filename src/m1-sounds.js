/* ============================================
   FULLBAN SEQ-TRAK — M1 Sound Database
   100 M1 multisounds on SEQTRAK (content 4210-4309)
   ============================================ */

const M1_SOUNDS = (() => {

  const CATEGORIES = [
    'Piano', 'Keyboard', 'Organ', 'Bass', 'Guitar', 'Pad', 'Strings',
    'Brass', 'Woodwind', 'World', 'Mallet', 'Bell', 'Rhythmic', 'SFX', 'Lead'
  ];

  // Category byte values (sound.bin offset 0x6E)
  const CAT_BYTE = {
    Bass: 0, Lead: 1, Piano: 2, Keyboard: 3, Organ: 4, Pad: 5, Strings: 6,
    Brass: 7, Woodwind: 8, Guitar: 9, World: 10, Mallet: 11, Bell: 12,
    Rhythmic: 13, SFX: 14
  };

  // All 100 sounds — from m1cat_manifest.json
  const SOUNDS = [
    { id: 0,  name: 'M1 Piano',      content: 4210, cat: 'Piano' },
    { id: 1,  name: 'M1 E.Piano 1',  content: 4211, cat: 'Keyboard' },
    { id: 2,  name: 'M1 E.Piano 2',  content: 4212, cat: 'Keyboard' },
    { id: 3,  name: 'M1 Clav',       content: 4213, cat: 'Keyboard' },
    { id: 4,  name: 'M1 Harpsicord', content: 4214, cat: 'Keyboard' },
    { id: 5,  name: 'M1 Organ 1',    content: 4215, cat: 'Organ' },
    { id: 6,  name: 'M1 Organ 2',    content: 4216, cat: 'Organ' },
    { id: 7,  name: 'M1 MagicOrgan', content: 4217, cat: 'Organ' },
    { id: 8,  name: 'M1 Guitar 1',   content: 4218, cat: 'Guitar' },
    { id: 9,  name: 'M1 Guitar 2',   content: 4219, cat: 'Guitar' },
    { id: 10, name: 'M1 E.Guitar',   content: 4220, cat: 'Guitar' },
    { id: 11, name: 'M1 Sitar 1',    content: 4221, cat: 'World' },
    { id: 12, name: 'M1 Sitar 2',    content: 4222, cat: 'World' },
    { id: 13, name: 'M1 A.Bass',     content: 4223, cat: 'Bass' },
    { id: 14, name: 'M1 Pick Bass',  content: 4224, cat: 'Bass' },
    { id: 15, name: 'M1 E.Bass',     content: 4225, cat: 'Bass' },
    { id: 16, name: 'M1 Fretless',   content: 4226, cat: 'Bass' },
    { id: 17, name: 'M1 SynthBass1', content: 4227, cat: 'Bass' },
    { id: 18, name: 'M1 SynthBass2', content: 4228, cat: 'Bass' },
    { id: 19, name: 'M1 Vibes',      content: 4229, cat: 'Mallet' },
    { id: 20, name: 'M1 Bell',       content: 4230, cat: 'Bell' },
    { id: 21, name: 'M1 Tubular',    content: 4231, cat: 'Bell' },
    { id: 22, name: 'M1 BellRing',   content: 4232, cat: 'Bell' },
    { id: 23, name: 'M1 Karimba',    content: 4233, cat: 'World' },
    { id: 24, name: 'M1 KarimbaNT',  content: 4234, cat: 'World' },
    { id: 25, name: 'M1 SynMallet',  content: 4235, cat: 'Mallet' },
    { id: 26, name: 'M1 Flute',      content: 4236, cat: 'Woodwind' },
    { id: 27, name: 'M1 Pan Flute',  content: 4237, cat: 'Woodwind' },
    { id: 28, name: 'M1 Bottles',    content: 4238, cat: 'Woodwind' },
    { id: 29, name: 'M1 Voices',     content: 4239, cat: 'Pad' },
    { id: 30, name: 'M1 Choir',      content: 4240, cat: 'Pad' },
    { id: 31, name: 'M1 Strings',    content: 4241, cat: 'Strings' },
    { id: 32, name: 'M1 Brass 1',    content: 4242, cat: 'Brass' },
    { id: 33, name: 'M1 Brass 2',    content: 4243, cat: 'Brass' },
    { id: 34, name: 'M1 Tenor Sax',  content: 4244, cat: 'Woodwind' },
    { id: 35, name: 'M1 Mute TP',    content: 4245, cat: 'Brass' },
    { id: 36, name: 'M1 Trumpet',    content: 4246, cat: 'Brass' },
    { id: 37, name: 'M1 TubaFlugel', content: 4247, cat: 'Brass' },
    { id: 38, name: 'M1 DoubleReed', content: 4248, cat: 'Woodwind' },
    { id: 39, name: 'M1 Koto Trem',  content: 4249, cat: 'World' },
    { id: 40, name: 'M1 BambooTrem', content: 4250, cat: 'World' },
    { id: 41, name: 'M1 Rhythm',     content: 4251, cat: 'Rhythmic' },
    { id: 42, name: 'M1 Lore',       content: 4252, cat: 'SFX' },
    { id: 43, name: 'M1 Lore NT',    content: 4253, cat: 'SFX' },
    { id: 44, name: 'M1 FlexaTone',  content: 4254, cat: 'SFX' },
    { id: 45, name: 'M1 WindBells',  content: 4255, cat: 'Bell' },
    { id: 46, name: 'M1 Pole',       content: 4256, cat: 'Mallet' },
    { id: 47, name: 'M1 Pole NT',    content: 4257, cat: 'Mallet' },
    { id: 48, name: 'M1 Block',      content: 4258, cat: 'Mallet' },
    { id: 49, name: 'M1 Block NT',   content: 4259, cat: 'Mallet' },
    { id: 50, name: 'M1 FingerSnap', content: 4260, cat: 'Rhythmic' },
    { id: 51, name: 'M1 Pop',        content: 4261, cat: 'SFX' },
    { id: 52, name: 'M1 Drop',       content: 4262, cat: 'SFX' },
    { id: 53, name: 'M1 Drop NT',    content: 4263, cat: 'SFX' },
    { id: 54, name: 'M1 Breath',     content: 4264, cat: 'SFX' },
    { id: 55, name: 'M1 Breath NT',  content: 4265, cat: 'SFX' },
    { id: 56, name: 'M1 Pluck',      content: 4266, cat: 'Guitar' },
    { id: 57, name: 'M1 Pluck NT',   content: 4267, cat: 'Guitar' },
    { id: 58, name: 'M1 Vibe Hit',   content: 4268, cat: 'Mallet' },
    { id: 59, name: 'M1 VibeHit NT', content: 4269, cat: 'Mallet' },
    { id: 60, name: 'M1 Hammer',     content: 4270, cat: 'SFX' },
    { id: 61, name: 'M1 Metal Hit',  content: 4271, cat: 'SFX' },
    { id: 62, name: 'M1 MetalHitNT', content: 4272, cat: 'SFX' },
    { id: 63, name: 'M1 Pick',       content: 4273, cat: 'Guitar' },
    { id: 64, name: 'M1 Distortion', content: 4274, cat: 'Guitar' },
    { id: 65, name: 'M1 Dist NT',    content: 4275, cat: 'Guitar' },
    { id: 66, name: 'M1 Bass Thumb', content: 4276, cat: 'Bass' },
    { id: 67, name: 'M1 BasThumNT1', content: 4277, cat: 'Bass' },
    { id: 68, name: 'M1 BasThumNT2', content: 4278, cat: 'Bass' },
    { id: 69, name: 'M1 Wire',       content: 4279, cat: 'SFX' },
    { id: 70, name: 'M1 PanWave',    content: 4280, cat: 'Lead' },
    { id: 71, name: 'M1 PingWave',   content: 4281, cat: 'Lead' },
    { id: 72, name: 'M1 Fv Wave',    content: 4282, cat: 'Pad' },
    { id: 73, name: 'M1 Mv Wave',    content: 4283, cat: 'Pad' },
    { id: 74, name: 'M1 Voice Wave', content: 4284, cat: 'Pad' },
    { id: 75, name: 'M1 VoiceWvNT1', content: 4285, cat: 'Pad' },
    { id: 76, name: 'M1 VoiceWvNT2', content: 4286, cat: 'Pad' },
    { id: 77, name: 'M1 DWGS E.P.1', content: 4287, cat: 'Keyboard' },
    { id: 78, name: 'M1 DWGS E.P.2', content: 4288, cat: 'Keyboard' },
    { id: 79, name: 'M1 DWGS E.P.3', content: 4289, cat: 'Keyboard' },
    { id: 80, name: 'M1 DWGS Piano', content: 4290, cat: 'Piano' },
    { id: 81, name: 'M1 DWGS Clav',  content: 4291, cat: 'Keyboard' },
    { id: 82, name: 'M1 DWGS Vibe',  content: 4292, cat: 'Mallet' },
    { id: 83, name: 'M1 DWGS Bass1', content: 4293, cat: 'Bass' },
    { id: 84, name: 'M1 DWGS Bass2', content: 4294, cat: 'Bass' },
    { id: 85, name: 'M1 DWGS Bell',  content: 4295, cat: 'Bell' },
    { id: 86, name: 'M1 DWGS Orgn1', content: 4296, cat: 'Organ' },
    { id: 87, name: 'M1 DWGS Orgn2', content: 4297, cat: 'Organ' },
    { id: 88, name: 'M1 DWGS Voice', content: 4298, cat: 'Pad' },
    { id: 89, name: 'M1 SquareWave', content: 4299, cat: 'Lead' },
    { id: 90, name: 'M1 Digital 1',  content: 4300, cat: 'Lead' },
    { id: 91, name: 'M1 Saw Wave',   content: 4301, cat: 'Lead' },
    { id: 92, name: 'M1 Digital 2',  content: 4302, cat: 'Lead' },
    { id: 93, name: 'M1 25% Pulse',  content: 4303, cat: 'Lead' },
    { id: 94, name: 'M1 10% Pulse',  content: 4304, cat: 'Lead' },
    { id: 95, name: 'M1 Digital 3',  content: 4305, cat: 'Lead' },
    { id: 96, name: 'M1 Digital 4',  content: 4306, cat: 'Lead' },
    { id: 97, name: 'M1 Digital 5',  content: 4307, cat: 'Lead' },
    { id: 98, name: 'M1 DWGS TRI',   content: 4308, cat: 'Lead' },
    { id: 99, name: 'M1 DWGS Sine',  content: 4309, cat: 'Lead' },
  ];

  // User wave range: 400-853 (454 zones total)
  const WAVE_BASE = 400;
  const WAVE_COUNT = 454;

  // Content range: 4210-4309
  const CONTENT_BASE = 4210;

  function getByCategory(cat) {
    if (!cat || cat === 'ALL') return SOUNDS;
    return SOUNDS.filter(s => s.cat === cat);
  }

  function getCategoryCounts() {
    const counts = {};
    SOUNDS.forEach(s => {
      counts[s.cat] = (counts[s.cat] || 0) + 1;
    });
    return counts;
  }

  function getById(id) {
    return SOUNDS[id] || null;
  }

  function getByContent(content) {
    return SOUNDS.find(s => s.content === content) || null;
  }

  return {
    CATEGORIES,
    CAT_BYTE,
    SOUNDS,
    WAVE_BASE,
    WAVE_COUNT,
    CONTENT_BASE,
    getByCategory,
    getCategoryCounts,
    getById,
    getByContent,
  };

})();
