#!/usr/bin/env node

/**
 * Targeted Qwen-Image-Edit repairs for the 2026-07-29 wardrobe QC.
 *
 * The existing insert-qwen-edit workflow is patched in memory only:
 * - the model sees a tight crop instead of the complete source;
 * - SetLatentNoiseMask limits sampling to the explicit repair mask;
 * - ImageCompositeMasked restores the generated crop into the untouched source.
 *
 * Originals are only read. Outputs and working files live below OUTPUT_ROOT.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const comfyUrl = process.env.QWEN_REPAIR_COMFY_URL ?? 'http://127.0.0.1:8189';
const outputRoot =
  process.env.QWEN_REPAIR_OUTPUT ??
  '/home/patrice/Videos/personas/garde-robe-reparee';
const workflowPath = new URL('./workflows/insert-qwen-edit.json', import.meta.url);
const commonInstruction =
  "Ne pas modifier le visage, les cheveux, l'expression, la lumière, le cadrage " +
  "ni le reste de la tenue. Conserver exactement l'identité canonique de la persona. " +
  'Retouche photoréaliste localisée uniquement dans le masque blanc, bords naturels, ' +
  'aucune nouvelle silhouette fantôme. Tout ce qui est hors masque doit rester identique.';

const A_AUTUMN = '/home/patrice/.codebuddy/personas/ambre/wardrobe-automne';
const A_BEACH = '/home/patrice/.codebuddy/personas/ambre/wardrobe-plage';
const L_STANDARD = '/home/patrice/.codebuddy/personas/lisa/wardrobe';
const L_AUTUMN = '/home/patrice/.codebuddy/personas/lisa/wardrobe-automne';
const A_COMPOSITES =
  '/home/patrice/Videos/personas/ambre-scenes/automne-composites';

const rightCutout = [{ type: 'rect', x: 950, y: 1470, width: 130, height: 450 }];
const leftGhost = {
  type: 'polygon',
  points: [
    [72, 720],
    [155, 720],
    [150, 1430],
    [112, 1920],
    [48, 1920],
  ],
};
const rightGhost = {
  type: 'polygon',
  points: [
    [850, 720],
    [955, 820],
    [930, 1510],
    [1080, 1690],
    [1080, 1920],
    [850, 1600],
  ],
};

const tasks = [
  {
    id: 1,
    slug: 'ambre-cocooning-flanelle-sapin',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-cocooning-flanelle-sapin.png`,
    prompt:
      'Supprimer le triangle blanc de détourage au bord inférieur droit. ' +
      'Reconstruire le bord et la manche du cardigan en grosse maille crème, avec la ' +
      "même texture et le même éclairage, puis prolonger naturellement l'arrière-plan " +
      'derrière la silhouette.',
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 2,
    slug: 'ambre-doudoune-sapin',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-doudoune-sapin.png`,
    prompt:
      'Supprimer le trou blanc angulaire au bord inférieur droit. Reconstruire la ' +
      'manche de doudoune vert sapin matelassée, avec coutures horizontales continues ' +
      "et contour d'épaule naturel, puis restaurer le fond.",
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 3,
    slug: 'ambre-kimono-manteau-rouille',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-kimono-manteau-rouille.png`,
    prompt:
      'Effacer le triangle blanc de masque au bord inférieur droit. Reconstituer la ' +
      'manche et le bord du kimono-manteau rouille avec le même motif floral, la même ' +
      'étoffe et un contour propre.',
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 4,
    slug: 'ambre-kimono-traditionnel-sakura',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-kimono-traditionnel-sakura.png`,
    prompt:
      'Retirer le trou blanc au bord inférieur droit et reconstruire la manche du ' +
      'kimono ivoire à fleurs de sakura, avec continuité exacte du tissu et des motifs.',
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 5,
    slug: 'ambre-manteau-voyage-bordeaux',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-manteau-voyage-bordeaux.png`,
    prompt:
      'Supprimer la découpe blanche angulaire à droite. Reconstituer le manteau ' +
      "bordeaux et son contour, sans changer l'écharpe crème, avec une transition " +
      "naturelle vers l'arrière-plan.",
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 6,
    slug: 'ambre-pull-torsade-creme',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-pull-torsade-creme.png`,
    prompt:
      'Effacer le triangle blanc au bord inférieur droit et reconstruire la manche du ' +
      'pull crème en torsades, en poursuivant exactement les mailles, les câbles et ' +
      "l'ombre du tissu.",
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 7,
    slug: 'ambre-trench-camel',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-trench-camel.png`,
    prompt:
      'Supprimer le trou blanc de détourage au bord inférieur droit et reconstruire ' +
      'le bord de manche du trench camel, couture et matière continues, fond naturel.',
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 8,
    slug: 'ambre-velours-cognac-echarpe',
    persona: 'ambre',
    source: `${A_AUTUMN}/ambre-velours-cognac-echarpe.png`,
    prompt:
      'Effacer le triangle blanc au bord inférieur droit et reconstruire la manche de ' +
      'veste en velours côtelé cognac, avec côtes régulières et contour naturel ; ' +
      "conserver l'écharpe vert sombre.",
    crop: { left: 820, top: 1320, width: 260, height: 600 },
    shapes: rightCutout,
  },
  {
    id: 9,
    slug: 'ambre-chemise-lin-chapeau',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-chemise-lin-chapeau.png`,
    prompt:
      "Supprimer la couture horizontale qui traverse l'image au niveau du bord du " +
      'chapeau, la ligne verticale à gauche et tous les contours de bras fantômes. ' +
      'Reconstituer un ciel et un arrière-plan continus, un bord de chapeau en paille ' +
      'régulier et une silhouette propre autour de la chemise blanche.',
    crop: { left: 0, top: 0, width: 1080, height: 1920 },
    shapes: [
      { type: 'rect', x: 38, y: 0, width: 56, height: 430 },
      { type: 'rect', x: 0, y: 385, width: 410, height: 58 },
      { type: 'rect', x: 745, y: 385, width: 335, height: 58 },
      leftGhost,
      rightGhost,
    ],
  },
  {
    id: 10,
    slug: 'ambre-combishort-lin-sable',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-combishort-lin-sable.png`,
    prompt:
      'Supprimer toutes les anciennes silhouettes de bras visibles à gauche et à ' +
      "droite. Recréer un arrière-plan continu autour du corps et un contour propre " +
      'des deux manches courtes en lin sable, sans modifier les boutons ni le col.',
    crop: { left: 0, top: 620, width: 1080, height: 1300 },
    shapes: [leftGhost, rightGhost],
  },
  {
    id: 11,
    slug: 'ambre-jupe-pareo-bandeau',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-jupe-pareo-bandeau.png`,
    prompt:
      'Supprimer les contours de bras fantômes. Refaire le côté du crop-top brun sous ' +
      "l'aisselle gauche anatomique : couture latérale continue, tissu brun uni, même " +
      "épaisseur que l'autre côté, aucune bande ou fente parasite. Garder le paréo " +
      'turquoise et son nœud inchangés.',
    crop: { left: 0, top: 620, width: 1080, height: 1300 },
    shapes: [
      leftGhost,
      rightGhost,
      { type: 'rect', x: 760, y: 980, width: 165, height: 360 },
    ],
  },
  {
    id: 12,
    slug: 'ambre-kimono-azur-une-piece',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-kimono-azur-une-piece.png`,
    prompt:
      'Reconstruire une encolure lisse et cohérente du maillot une-pièce bleu marine, ' +
      'sans marche ni encoche noire. Symétriser le kimono azur : deux manches fluides ' +
      'de même coupe et même longueur, tissu continu sous les aisselles. Supprimer les ' +
      'contours de bras fantômes.',
    crop: { left: 0, top: 650, width: 1080, height: 1270 },
    shapes: [
      leftGhost,
      rightGhost,
      { type: 'rect', x: 300, y: 930, width: 500, height: 500 },
      { type: 'rect', x: 150, y: 980, width: 220, height: 620 },
      { type: 'rect', x: 760, y: 980, width: 220, height: 620 },
    ],
  },
  {
    id: 13,
    slug: 'ambre-maillot-une-piece-corail',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-maillot-une-piece-corail.png`,
    prompt:
      "Réparer le raccord sous l'aisselle gauche anatomique : supprimer le décroché " +
      'et la double languette de tissu, prolonger le maillot corail en une courbe ' +
      'lisse et anatomique de la bretelle au flanc, même couleur et même matière.',
    crop: { left: 680, top: 720, width: 400, height: 760 },
    shapes: [{ type: 'rect', x: 760, y: 850, width: 250, height: 540 }],
  },
  {
    id: 14,
    slug: 'ambre-robe-longue-fluide-dos-nu',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-robe-longue-fluide-dos-nu.png`,
    prompt:
      "Symétriser l'encolure halter orange : deux pans de satin de même largeur " +
      'partant du buste et se rejoignant proprement derrière le cou, décolleté centré, ' +
      'plis naturels et équilibrés. Supprimer les contours de bras fantômes.',
    crop: { left: 0, top: 650, width: 1080, height: 1270 },
    shapes: [
      leftGhost,
      rightGhost,
      { type: 'polygon', points: [[300, 760], [790, 760], [820, 1470], [260, 1470]] },
    ],
  },
  {
    id: 15,
    slug: 'ambre-robe-plage-crochet-ecru',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-robe-plage-crochet-ecru.png`,
    prompt:
      "Supprimer les silhouettes de bras fantômes. Reconstituer l'épaule et la petite " +
      'manche gauche en crochet écru pour correspondre à la manche droite, même motif, ' +
      'même densité et raccord naturel sous les cheveux.',
    crop: { left: 0, top: 650, width: 1080, height: 1270 },
    shapes: [
      leftGhost,
      rightGhost,
      { type: 'rect', x: 170, y: 790, width: 310, height: 620 },
    ],
  },
  {
    id: 16,
    slug: 'ambre-une-piece-blanc-pareo-imprime',
    persona: 'ambre',
    source: `${A_BEACH}/ambre-une-piece-blanc-pareo-imprime.png`,
    prompt:
      "Refaire l'encolure du maillot blanc : deux bretelles symétriques, courbe " +
      'régulière sans encoche verticale, boutonnage centré et boutons parfaitement ' +
      "alignés. Supprimer la découpe blanche sous l'aisselle et tous les contours de " +
      'bras fantômes. Conserver le paréo imprimé.',
    crop: { left: 0, top: 650, width: 1080, height: 1270 },
    shapes: [
      leftGhost,
      rightGhost,
      { type: 'rect', x: 275, y: 760, width: 545, height: 690 },
      { type: 'rect', x: 760, y: 950, width: 190, height: 430 },
    ],
  },
  {
    id: 17,
    slug: 'lisa-jean-chemisier',
    persona: 'lisa',
    source: `${L_STANDARD}/lisa-jean-chemisier.png`,
    prompt:
      'Reconstruire le pan de col manquant du chemisier bleu clair sous les cheveux, ' +
      'symétrique au pan visible : deux pointes de col nettes, encolure centrale ' +
      'régulière sans encoche dentelée, patte de boutonnage droite. Supprimer les fins ' +
      'contours de silhouette fantômes.',
    crop: { left: 120, top: 650, width: 840, height: 950 },
    shapes: [
      { type: 'rect', x: 300, y: 800, width: 500, height: 520 },
      { type: 'rect', x: 105, y: 850, width: 100, height: 730 },
      { type: 'rect', x: 875, y: 850, width: 100, height: 730 },
    ],
  },
  {
    id: 18,
    slug: 'lisa-col-roule-bordeaux',
    persona: 'lisa',
    source: `${L_AUTUMN}/lisa-col-roule-bordeaux.png`,
    prompt:
      'Transformer les deux pans fendus du cou en un col roulé bordeaux continu, ' +
      'cylindrique et symétrique, en maille côtelée régulière, sans encoche ni ouverture ' +
      'au centre, raccord naturel avec les épaules.',
    crop: { left: 240, top: 720, width: 600, height: 650 },
    shapes: [{ type: 'rect', x: 345, y: 820, width: 390, height: 430 }],
  },
  {
    id: 19,
    slug: 'ambre-030-salon-dore-flanelle',
    persona: 'ambre',
    source: `${A_COMPOSITES}/ambre-030-salon-dore-flanelle.png`,
    guidance: `${A_COMPOSITES}/ambre-002-chalet-exterieur-flanelle.png`,
    prompt:
      'Dans image 1, remplacer uniquement le pull crème uni par la tenue montrée dans ' +
      "image 2 : chemise de flanelle tartan vert, rouge et crème avec boutons alignés, " +
      'sous un cardigan crème en grosse maille. Conserver la pose debout, le pantalon ' +
      "noir, les chaussures, la lumière du salon et le visage canonique d'Ambre.",
    crop: { left: 600, top: 90, width: 330, height: 320 },
    shapes: [
      { type: 'polygon', points: [[690, 135], [845, 135], [865, 325], [665, 325]] },
    ],
  },
  {
    id: 20,
    slug: 'ambre-034-ruelle-pluie-trench',
    persona: 'ambre',
    source: `${A_COMPOSITES}/ambre-034-ruelle-pluie-trench.png`,
    prompt:
      "Reconstruire tout le bas du corps à partir de l'ourlet du trench : jambes " +
      'anatomiques en pantalon sombre, bottines adaptées à la pluie, pieds posés sur ' +
      'les pavés. Le trench ne doit plus se fondre dans la rue. Ajouter une ombre de ' +
      'contact et un reflet humide réalistes, sans masquer les pavés.',
    crop: { left: 410, top: 430, width: 440, height: 290 },
    shapes: [
      { type: 'polygon', points: [[520, 540], [735, 540], [790, 720], [455, 720]] },
    ],
  },
  {
    id: 21,
    slug: 'ambre-035-ruelle-pluie-bordeaux',
    persona: 'ambre',
    source: `${A_COMPOSITES}/ambre-035-ruelle-pluie-bordeaux.png`,
    prompt:
      "Reconstituer le corps entier d'Ambre : prolonger le manteau bordeaux sous la " +
      'taille, ajouter deux bras complets avec mains naturelles au repos ou dans les ' +
      'poches, pantalon sombre, jambes et bottines posées sur les pavés. Supprimer ' +
      "l'effet de torse immergé et créer une ombre et un reflet humide crédibles.",
    crop: { left: 420, top: 260, width: 430, height: 460 },
    shapes: [
      { type: 'polygon', points: [[520, 290], [790, 290], [820, 720], [450, 720]] },
    ],
  },
  {
    id: 22,
    slug: 'ambre-kimono-azur-une-piece-short-qc',
    persona: 'ambre',
    source:
      '/home/patrice/Videos/personas/garde-robe-reparee/final/' +
      'ambre-kimono-azur-une-piece.png',
    prompt:
      "Réparer uniquement l'encolure du débardeur-maillot bleu marine. Créer une " +
      'encolure débardeur classique, lisse et continue, avec deux bretelles de même ' +
      'largeur et une courbe centrale régulière. Effacer le décroché rectangulaire noir ' +
      "au centre gauche et créer une séparation nette entre le tissu marine et l'épaule " +
      "gauche de l'image : aucun tissu ne doit se fondre dans la peau. Conserver " +
      'exactement le kimono azur, les cheveux, le visage, le buste, la ceinture, les ' +
      'bras et tout le reste de la photographie.',
    crop: { left: 240, top: 650, width: 620, height: 610 },
    shapes: [
      {
        type: 'polygon',
        points: [[285, 715], [745, 665], [820, 830], [765, 1080], [315, 1090]],
      },
    ],
  },
  {
    id: 23,
    slug: 'ambre-maillot-une-piece-corail-short-qc',
    persona: 'ambre',
    source:
      '/home/patrice/Videos/personas/garde-robe-reparee/final/' +
      'ambre-maillot-une-piece-corail.png',
    prompt:
      "Supprimer uniquement les formes anatomiques parasites du côté droit de l'image. " +
      "Sous l'aisselle, retirer la masse de chair et la languette de tissu corail qui " +
      "occupent l'espace entre le bras droit et le flanc, puis reconstruire l'arrière-" +
      'plan sombre visible à travers cet espace : cette zone doit contenir uniquement ' +
      "le fond vert-noir, absolument aucune peau ni tissu. Conserver un seul bras droit, avec un " +
      'coude anatomique et un contour continu jusqu’à la main posée sur la hanche. ' +
      "Supprimer aussi le second fragment de bras qui entre depuis le bord inférieur " +
      "droit : tout ce bord doit redevenir l'arrière-plan, sans membre ni forme chair. " +
      "Ne modifier ni le bras principal ni le " +
      'maillot en dehors de ces raccords.',
    crop: { left: 650, top: 470, width: 430, height: 1410 },
    shapes: [
      {
        type: 'polygon',
        points: [[760, 920], [860, 890], [925, 1015], [870, 1235], [755, 1185]],
      },
      {
        type: 'polygon',
        points: [[990, 1080], [1080, 1090], [1080, 1715], [985, 1605]],
      },
    ],
  },
  {
    id: 24,
    slug: 'ambre-robe-longue-fluide-dos-nu-short-qc',
    persona: 'ambre',
    source:
      '/home/patrice/Videos/personas/garde-robe-reparee/final/' +
      'ambre-robe-longue-fluide-dos-nu.png',
    prompt:
      'Réparer uniquement le drapé du corsage orange. Refaire les deux pans de satin ' +
      'avec une largeur, une tension et des plis cohérents de part et d’autre du ' +
      'décolleté, en conservant le décolleté centré et les deux attaches au cou. Les ' +
      'plis doivent descendre naturellement et de façon équilibrée jusqu’à la ceinture. ' +
      'Conserver exactement la peau, les bras, les cheveux, le visage, la ceinture et ' +
      "l'arrière-plan.",
    crop: { left: 180, top: 650, width: 720, height: 970 },
    shapes: [
      {
        type: 'polygon',
        points: [[275, 755], [785, 700], [850, 1455], [740, 1545], [290, 1545], [220, 1410]],
      },
    ],
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function endpoint(route) {
  return `${comfyUrl.replace(/\/+$/u, '')}${route}`;
}

async function getJson(route, options = undefined) {
  const response = await fetch(endpoint(route), options);
  if (!response.ok) {
    throw new Error(`${options?.method ?? 'GET'} ${route}: HTTP ${response.status}`);
  }
  return response.json();
}

async function uploadImage(filePath, remoteName) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set('image', new Blob([bytes], { type: 'image/png' }), remoteName);
  form.set('type', 'input');
  form.set('overwrite', 'true');
  const result = await getJson('/upload/image', { method: 'POST', body: form });
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function maskSvg(width, height, shapes) {
  const body = shapes
    .map((shape) => {
      if (shape.type === 'rect') {
        return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="white"/>`;
      }
      if (shape.type === 'polygon') {
        const points = shape.points.map(([x, y]) => `${x},${y}`).join(' ');
        return `<polygon points="${points}" fill="white"/>`;
      }
      throw new Error(`Unsupported mask shape: ${shape.type}`);
    })
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="black"/>${body}</svg>`,
  );
}

async function prepareInputs(task, attempt) {
  const sourceMetadata = await sharp(task.source).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error(`Could not read dimensions: ${task.source}`);
  }
  const workDir = path.join(outputRoot, '_work', task.slug, `attempt-${attempt}`);
  await mkdir(workDir, { recursive: true });
  const cropPath = path.join(workDir, 'source-crop.png');
  const maskPath = path.join(workDir, 'mask-crop.png');
  await sharp(task.source).extract(task.crop).png().toFile(cropPath);

  const fullMask = await sharp(
    maskSvg(sourceMetadata.width, sourceMetadata.height, task.shapes),
  )
    .png()
    .blur(7)
    .toBuffer();
  await sharp(fullMask).extract(task.crop).png().toFile(maskPath);

  return { cropPath, maskPath, workDir };
}

function configureWorkflow(
  template,
  task,
  attempt,
  cropName,
  maskName,
  sourceName,
  guidanceName,
) {
  const graph = clone(template);
  const refined =
    attempt === 1
      ? ''
      : " Deuxième et dernière tentative : le premier résultat n'a pas franchi toutes " +
        'les portes qualité. Corriger exclusivement le défaut décrit, avec une ' +
        'géométrie plus simple, symétrique et anatomiquement plausible. Ne créer ni ' +
        'couture parasite, ni membre supplémentaire, ni halo.';
  graph['4'].inputs.image = cropName;
  graph['5'].inputs.image = guidanceName ?? cropName;
  graph['6'].inputs.prompt = `${task.prompt} ${commonInstruction}${refined}`;
  graph['9'].inputs.pixels = ['4', 0];
  graph['10'].inputs.seed = 7300000 + task.id * 10 + attempt;
  graph['10'].inputs.latent_image = ['15', 0];
  graph['12'].inputs.images = ['18', 0];
  graph['12'].inputs.filename_prefix =
    `wardrobe-repairs-2026-07-30/${task.slug}-attempt-${attempt}`;
  graph['13'] = {
    class_type: 'LoadImage',
    inputs: { image: maskName },
    _meta: { title: 'Repair Mask' },
  };
  graph['14'] = {
    class_type: 'ImageToMask',
    inputs: { image: ['13', 0], channel: 'red' },
    _meta: { title: 'Mask from white channel' },
  };
  graph['15'] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['9', 0], mask: ['14', 0] },
    _meta: { title: 'Masked latent only' },
  };
  graph['16'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['4', 0],
      source: ['11', 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ['14', 0],
    },
    _meta: { title: 'Exact source outside crop mask' },
  };
  graph['17'] = {
    class_type: 'LoadImage',
    inputs: { image: sourceName },
    _meta: { title: 'Untouched full source' },
  };
  graph['18'] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['17', 0],
      source: ['16', 0],
      x: task.crop.left,
      y: task.crop.top,
      resize_source: false,
      mask: ['14', 0],
    },
    _meta: { title: 'Restore masked crop into full source' },
  };
  return graph;
}

async function runGraph(graph, label) {
  const submitted = await getJson('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
  });
  if (!submitted.prompt_id) {
    throw new Error(`ComfyUI rejected ${label}: ${JSON.stringify(submitted)}`);
  }
  console.log(`SUBMITTED ${label} ${submitted.prompt_id}`);
  const deadline = Date.now() + 20 * 60_000;
  let history;
  while (Date.now() < deadline) {
    const current = await getJson(`/history/${submitted.prompt_id}`);
    history = current[submitted.prompt_id];
    if (history?.status?.completed) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!history?.status?.completed) {
    throw new Error(`Timed out waiting for ${label}`);
  }
  if (history.status.status_str !== 'success') {
    throw new Error(`${label} failed: ${JSON.stringify(history.status)}`);
  }
  const image = Object.values(history.outputs ?? {})
    .flatMap((output) => output.images ?? [])
    .at(0);
  if (!image) throw new Error(`No output image for ${label}`);
  return { promptId: submitted.prompt_id, image, status: history.status };
}

async function downloadImage(image, destination) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  const response = await fetch(endpoint(`/view?${query.toString()}`));
  if (!response.ok) throw new Error(`GET /view: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function selectedTasks() {
  const only = process.argv.find((value) => value.startsWith('--only='));
  if (!only) return tasks;
  const requested = new Set(
    only
      .slice('--only='.length)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return tasks.filter(
    (task) => requested.has(String(task.id)) || requested.has(task.slug),
  );
}

async function main() {
  const attempt = Number(
    process.argv.find((value) => value.startsWith('--attempt='))?.split('=')[1] ?? 1,
  );
  if (![1, 2].includes(attempt)) {
    throw new Error('--attempt must be 1 or 2');
  }
  const stats = await getJson('/system_stats');
  if (stats.system?.os !== 'win32') {
    throw new Error(`Refusing non-Darkstar ComfyUI: os=${stats.system?.os}`);
  }
  const queue = await getJson('/queue');
  if (queue.queue_running?.length || queue.queue_pending?.length) {
    throw new Error('Refusing to start: Darkstar ComfyUI queue is not empty');
  }
  const template = JSON.parse(await readFile(workflowPath, 'utf8'));
  await mkdir(outputRoot, { recursive: true });
  const metricsPath = path.join(outputRoot, 'run-metrics.json');
  let metrics = [];
  try {
    metrics = JSON.parse(await readFile(metricsPath, 'utf8'));
  } catch {
    metrics = [];
  }

  for (const task of selectedTasks()) {
    const label = `${task.id.toString().padStart(2, '0')}/${task.slug}/attempt-${attempt}`;
    console.log(`PREPARE ${label}`);
    const prepared = await prepareInputs(task, attempt);
    const prefix = `repair-${task.id.toString().padStart(2, '0')}-a${attempt}`;
    const cropName = await uploadImage(prepared.cropPath, `${prefix}-crop.png`);
    const maskName = await uploadImage(prepared.maskPath, `${prefix}-mask.png`);
    const sourceName = await uploadImage(task.source, `${prefix}-source.png`);
    const guidanceName = task.guidance
      ? await uploadImage(task.guidance, `${prefix}-guidance.png`)
      : undefined;
    const graph = configureWorkflow(
      template,
      task,
      attempt,
      cropName,
      maskName,
      sourceName,
      guidanceName,
    );
    await writeFile(
      path.join(prepared.workDir, 'prompt.json'),
      `${JSON.stringify(graph, null, 2)}\n`,
    );
    const startedAt = Date.now();
    const result = await runGraph(graph, label);
    const destination = path.join(
      outputRoot,
      attempt === 1 ? `${task.slug}.png` : `${task.slug}-retry.png`,
    );
    await downloadImage(result.image, destination);
    const outputMetadata = await sharp(destination).metadata();
    const sourceMetadata = await sharp(task.source).metadata();
    if (
      outputMetadata.width !== sourceMetadata.width ||
      outputMetadata.height !== sourceMetadata.height
    ) {
      throw new Error(
        `${label}: output dimensions ${outputMetadata.width}x${outputMetadata.height} ` +
          `do not match source ${sourceMetadata.width}x${sourceMetadata.height}`,
      );
    }
    metrics = metrics.filter(
      (entry) => !(entry.id === task.id && entry.attempt === attempt),
    );
    metrics.push({
      id: task.id,
      slug: task.slug,
      persona: task.persona,
      source: task.source,
      output: destination,
      attempt,
      seed: graph['10'].inputs.seed,
      prompt: graph['6'].inputs.prompt,
      crop: task.crop,
      promptId: result.promptId,
      durationSeconds: (Date.now() - startedAt) / 1000,
      costUsd: 0,
    });
    metrics.sort((left, right) => left.id - right.id || left.attempt - right.attempt);
    await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`DONE ${label} -> ${destination}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
