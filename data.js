// Grid Monsters v7 — roster data. Transcribed from SPEC.md §6/§7; schema per CONTRACT.md.
// This file later seeds a Godot build: keep it a pure JSON-compatible literal.
const GM_DATA = {
  boardSize: 8,
  typeChart: {
    Fire: ['Grass', 'Ice'],
    Water: ['Fire', 'Ground'],
    Grass: ['Water', 'Ground'],
    Electric: ['Water', 'Flying'],
    Ground: ['Fire', 'Electric'],
    Flying: ['Grass'],
    Psychic: [],
    Dark: ['Psychic'],
    Ice: ['Grass', 'Ground', 'Flying'],
  },
  tyrants: ['cinderling', 'wyrmlet', 'frostfawn'],
  lines: [
    {
      id: 'cinderling', num: 1, type: 'Fire', tyrant: true,
      stages: [
        { name: 'Cinderling', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Flarewyrm', hp: 5, speed: 3, basic: 2, special: { name: 'Ember Stream', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 7 } },
        { name: 'Pyroclasm', hp: 6, speed: 6, basic: 2, special: { name: 'Magma Stream', pattern: 'lance', range: 3, dmg: 3, effects: [{ kind: 'burn', n: 2 }], riders: [{ kind: 'recoil', n: 2 }] }, traits: [], aura: null, rival: true, evolve: null },
      ],
    },
    {
      id: 'sootpup', num: 2, type: 'Fire', tyrant: false,
      stages: [
        { name: 'Sootpup', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'ko' } },
        { name: 'Hellhowl', hp: 7, speed: 5, basic: 2, special: { name: 'Scorching Howl', pattern: 'cone', dmg: 3, effects: [{ kind: 'push', n: 1 }, { kind: 'burn', n: 1, nearOnly: true }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'snapling', num: 3, type: 'Water', tyrant: false,
      stages: [
        { name: 'Snapling', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 2 } },
        { name: 'Shellbrook', hp: 5, speed: 3, basic: 2, special: { name: 'Jet Spray', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 5 } },
        { name: 'Bulwhark', hp: 8, speed: 3, basic: 2, special: { name: 'Tidal Ram', pattern: 'single', range: 3, dmg: 3, effects: [{ kind: 'push', n: 1 }], riders: [{ kind: 'lunge' }] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'guppling', num: 4, type: 'Water', tyrant: false,
      stages: [
        { name: 'Guppling', hp: 3, speed: 2, basic: 1, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 4 } },
        { name: 'Leviadon', hp: 8, speed: 4, basic: 2, special: { name: 'Maelstrom', pattern: 'burst', dmg: 3, effects: [{ kind: 'push', n: 1 }], riders: [] }, traits: [], aura: 'hungryDepths', rival: false, evolve: null },
      ],
    },
    {
      id: 'mosskit', num: 5, type: 'Grass', tyrant: false,
      stages: [
        { name: 'Mosskit', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 2 } },
        { name: 'Thornhide', hp: 5, speed: 3, basic: 2, special: { name: 'Thorn Lash', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 5 } },
        { name: 'Grovewarden', hp: 8, speed: 3, basic: 2, special: { name: 'Sunlance', pattern: 'lance', range: 3, dmg: 3, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'podling', num: 6, type: 'Grass', tyrant: false,
      stages: [
        { name: 'Podling', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 3 } },
        { name: 'Bombloom', hp: 7, speed: 2, basic: 2, special: { name: 'Seed Mortar', pattern: 'bomb', range: 2, dmg: 2, effects: [{ kind: 'pin', centerOnly: true }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'zapkitt', num: 7, type: 'Electric', tyrant: false,
      stages: [
        { name: 'Zapkitt', hp: 3, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Joltlynx', hp: 5, speed: 3, basic: 2, special: { name: 'Jolt Swipe', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 7 } },
        { name: 'Fulgurlynx', hp: 6, speed: 5, basic: 2, special: { name: 'Stormbolt', pattern: 'single', range: 3, dmg: 4, effects: [{ kind: 'pin' }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'coilbug', num: 8, type: 'Electric', tyrant: false,
      stages: [
        { name: 'Coilbug', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 4 } },
        { name: 'Dynamoth', hp: 6, speed: 4, basic: 2, special: { name: 'Arc Volley', pattern: 'scatter', range: 2, count: 3, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'gritling', num: 9, type: 'Ground', tyrant: false,
      stages: [
        { name: 'Gritling', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 2 } },
        { name: 'Stonehide', hp: 5, speed: 3, basic: 2, special: { name: 'Stone Toss', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 5 } },
        { name: 'Terradon', hp: 8, speed: 3, basic: 2, special: { name: 'Avalanche Roll', pattern: 'single', range: 3, dmg: 2, effects: [{ kind: 'push', n: 1 }], riders: [{ kind: 'lunge' }] }, traits: [], aura: 'earthquake', rival: false, evolve: null },
      ],
    },
    {
      id: 'cacklet', num: 10, type: 'Ground', tyrant: false,
      stages: [
        { name: 'Cacklet', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'allyKo' } },
        { name: 'Ossiyena', hp: 6, speed: 4, basic: 2, special: { name: 'Marrow Hurl', pattern: 'lance', range: 2, dmg: 1, effects: [{ kind: 'poison' }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'wyrmlet', num: 11, type: 'Flying', tyrant: true,
      stages: [
        { name: 'Wyrmlet', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 3 } },
        { name: 'Galewyrm', hp: 6, speed: 3, basic: 2, special: { name: 'Gale Breath', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 8 } },
        { name: 'Tempestdrake', hp: 8, speed: 6, basic: 2, special: { name: 'Tempest Ray', pattern: 'lance', range: 4, dmg: 3, effects: [], riders: [{ kind: 'recoil', n: 1 }] }, traits: [], aura: 'localStorm', rival: true, evolve: null },
      ],
    },
    {
      id: 'falchick', num: 12, type: 'Flying', tyrant: false,
      stages: [
        { name: 'Falchick', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 4 } },
        { name: 'Peregale', hp: 6, speed: 5, basic: 2, special: { name: 'Stoop Strike', pattern: 'single', range: 2, dmg: 2, effects: [{ kind: 'pin' }], riders: [{ kind: 'lunge' }] }, traits: ['talonlock'], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'tavrik', num: 13, type: 'Fire', tyrant: false,
      stages: [
        { name: 'Tavrik', hp: 5, speed: 4, basic: 2, special: { name: 'Napebite', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: ['tyrantbane'], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'hootle', num: 14, type: 'Psychic', tyrant: false,
      stages: [
        { name: 'Hootle', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 2 } },
        { name: 'Parliowl', hp: 5, speed: 3, basic: 2, special: { name: 'Telegrab', pattern: 'telegrab', range: 2, relocate: 1, telesmash: false }, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 5 } },
        { name: 'Archistrix', hp: 6, speed: 4, basic: 2, special: { name: 'Telegrab', pattern: 'telegrab', range: 3, relocate: 2, telesmash: true }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'mystikit', num: 15, type: 'Psychic', tyrant: false,
      stages: [
        { name: 'Mystikit', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Velvesper', hp: 6, speed: 5, basic: 2, special: { name: 'Mindclaw', pattern: 'single', range: 1, dmg: 3, effects: [], riders: [{ kind: 'blink', n: 2 }] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'shadekit', num: 16, type: 'Dark', tyrant: false,
      stages: [
        { name: 'Shadekit', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Duskpard', hp: 5, speed: 3, basic: 2, special: { name: 'Shadow Swipe', pattern: 'single', range: 1, dmg: 2, effects: [], riders: [] }, traits: ['skulk'], aura: null, rival: false, evolve: { kind: 'ko' } },
        { name: 'Pantherebus', hp: 6, speed: 5, basic: 2, special: { name: 'Night Fang', pattern: 'single', range: 1, dmg: 3, effects: [], riders: [{ kind: 'lunge' }] }, traits: ['skulk', 'backstab'], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'glimlure', num: 17, type: 'Dark', tyrant: false,
      stages: [
        { name: 'Glimlure', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 3 } },
        { name: 'Mawlantern', hp: 7, speed: 3, basic: 2, special: { name: 'Lure Light', pattern: 'single', range: 3, dmg: 1, effects: [{ kind: 'lure' }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'frostfawn', num: 18, type: 'Ice', tyrant: true,
      stages: [
        { name: 'Frostfawn', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 3 } },
        { name: 'Rimestag', hp: 6, speed: 3, basic: 2, special: { name: 'Frost Gore', pattern: 'single', range: 2, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 7 } },
        { name: 'Gravewinter', hp: 10, speed: 4, basic: 2, special: { name: 'Glacial Gore', pattern: 'cone', dmg: 3, bonusPerChill: true, effects: [{ kind: 'chill', n: 1 }], riders: [] }, traits: [], aura: 'dreadPresence', rival: true, evolve: null },
      ],
    },
    {
      id: 'floecub', num: 19, type: 'Ice', tyrant: false,
      stages: [
        { name: 'Floecub', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Frostursa', hp: 6, speed: 3, basic: 2, special: { name: 'Ice Swipe', pattern: 'single', range: 1, dmg: 2, effects: [], riders: [] }, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 7 } },
        { name: 'Maulberg', hp: 8, speed: 4, basic: 2, special: { name: 'Avalanche Maul', pattern: 'single', range: 1, dmg: 4, effects: [{ kind: 'chill', n: 1 }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'pupfloe', num: 20, type: 'Ice', tyrant: false,
      stages: [
        { name: 'Pupfloe', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Floefang', hp: 6, speed: 4, basic: 2, special: { name: 'Breach Bite', pattern: 'single', range: 2, dmg: 3, effects: [{ kind: 'chill', n: 1 }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'quillet', num: 21, type: 'Electric', tyrant: false,
      stages: [
        { name: 'Quillet', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'survived', n: 3 } },
        { name: 'Galvaquill', hp: 7, speed: 3, basic: 2, special: { name: 'Quill Burst', pattern: 'burst', dmg: 2, effects: [], riders: [] }, traits: ['staticQuills'], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'slithrin', num: 22, type: 'Water', tyrant: false,
      stages: [
        { name: 'Slithrin', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 3 } },
        { name: 'Servenom', hp: 6, speed: 4, basic: 2, special: { name: 'Venom Fang', pattern: 'single', range: 1, dmg: 2, effects: [{ kind: 'poison' }], riders: [] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'pebblepaw', num: 23, type: 'Ground', tyrant: false,
      stages: [
        { name: 'Pebblepaw', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 4 } },
        { name: 'Pumarok', hp: 6, speed: 5, basic: 2, special: { name: 'Pounce', pattern: 'single', range: 2, dmg: 3, effects: [], riders: [{ kind: 'lunge' }] }, traits: [], aura: null, rival: false, evolve: null },
      ],
    },
    {
      id: 'shriket', num: 24, type: 'Dark', tyrant: false,
      stages: [
        { name: 'Shriket', hp: 4, speed: 2, basic: 2, special: null, traits: [], aura: null, rival: false, evolve: { kind: 'dealt', n: 4 } },
        { name: 'Butcherbeak', hp: 5, speed: 5, basic: 2, special: { name: 'Impale', pattern: 'single', range: 1, dmg: 2, effects: [{ kind: 'pin' }], riders: [] }, traits: ['butcher'], aura: null, rival: false, evolve: null },
      ],
    },
  ],
};
if (typeof module !== 'undefined') module.exports = GM_DATA;
