"""Catalogue de la campagne Flow/Veo Lisa + Ambre du 2026-07-28."""

from __future__ import annotations

from pathlib import Path


# Six prises donnent 240 soumissions candidates. Le pilote s'arrête sur le
# compteur live à 20 000 crédits nets : les prises 6 servent seulement à
# réinvestir d'éventuels remboursements Flow sans inventer de nouvelles invites.
TAKES_PER_PROMPT = 6

EMPTY_169 = (
    ' Absolutely empty environment: no person, no human, no human silhouette, no face, '
    'no body, no hand, no human reflection, no animal. Keep the center frame and central '
    'visual axis uncluttered, with generous clean negative space for later foreground '
    'compositing. Photorealistic premium cinematic footage, restrained natural color, '
    'subtle film grain, slow fluid and perfectly stable camera movement, no brand, no logo, '
    'no watermark, no readable text, landscape 16:9, one continuous eight-second shot with '
    'subtle native ambient sound.'
)

EMPTY_916 = (
    ' Absolutely empty environment: no person, no human, no human silhouette, no face, '
    'no body, no hand, no human reflection, no animal. Keep the center frame and central '
    'visual axis uncluttered, with generous clean negative space for later foreground '
    'compositing. Photorealistic premium cinematic footage, restrained natural color, '
    'subtle film grain, slow fluid and perfectly stable camera movement, no brand, no logo, '
    'no watermark, no readable text, vertical 9:16, one continuous eight-second shot with '
    'subtle native ambient sound.'
)


AMBRE_AUTOMNE_BASE: list[tuple[str, str, str]] = [
    # Chalet suisse — échelles large, moyenne et détail, du matin à la nuit.
    (
        'ambre-chalet-01',
        'Wide establishing view of an authentic dark-timber Swiss chalet beneath fresh snow '
        'in the Alps at pale winter dawn, warm windows, faint chimney smoke, untouched '
        'foreground snow and a slow gentle push toward the façade.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-chalet-02',
        'Medium interior view of a refined Swiss chalet salon at night, a stone fireplace '
        'burning softly, honey-colored timber, wool throws and low amber lamps arranged only '
        'along the edges, broad open floor space in the middle.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-chalet-03',
        'Intimate detail of frost crystals along the edge of a large chalet window at blue '
        'hour, snow-covered Alpine peaks visible beyond, soft firelight reflected only in '
        'the glass margins and a calm open view through the center.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-chalet-04',
        'Covered wooden chalet terrace during gentle afternoon snowfall, a folded cream '
        'blanket and one steaming ceramic cup resting on a side bench, majestic Alps beyond '
        'and the center deck completely clear, slow lateral drift.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-chalet-05',
        'Vertical view from a snowy path toward a traditional Swiss timber chalet just after '
        'sunset, warm lanterns at the sides, delicate falling snow and an unobstructed central '
        'approach leading to the door.' + EMPTY_916,
        '9:16',
    ),
    (
        'ambre-chalet-06',
        'Vertical medium shot inside a small alpine fireside nook before sunrise, glowing '
        'embers, pale timber, a wool blanket and tea tray kept to the lower edge, tall frosted '
        'window and clean center composition.' + EMPTY_916,
        '9:16',
    ),
    # Japon en fleurs — serein, graphique, jamais touristique ni peuplé.
    (
        'ambre-sakura-01',
        'Wide symmetrical avenue of mature cherry trees in full bloom at sunrise, soft pink '
        'petals falling across an empty stone path, low morning mist and a distant wooden gate, '
        'slow centered glide.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-sakura-02',
        'Wide Japanese temple garden in luminous early morning, a small traditional temple far '
        'in the background beyond flowering sakura, raked gravel and moss framing a broad clean '
        'central foreground.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-sakura-03',
        'Medium view across a Japanese garden during fine spring rain, wet stepping stones, '
        'soft cherry blossom reflections and restrained stone lanterns at the edges, clear '
        'center path, slow parallax.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-sakura-04',
        'Close cinematic detail of pale sakura petals drifting onto rain-darkened stone beside '
        'a shallow garden stream at late afternoon, delicate ripples and warm wood bokeh, '
        'uncluttered visual center.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-sakura-05',
        'Vertical empty sakura walkway at first light, arching blossom branches forming a tall '
        'natural frame, petals moving in a light breeze and a small temple roof in the distance, '
        'open center path.' + EMPTY_916,
        '9:16',
    ),
    (
        'ambre-sakura-06',
        'Vertical Japanese garden lane in fine rain at dusk, two traditional paper lanterns '
        'glowing softly at opposite edges beneath cherry blossoms, wet stones leading through '
        'a completely open center.' + EMPTY_916,
        '9:16',
    ),
    # Cocooning — matière, lumière et météo plutôt que sur-décoration.
    (
        'ambre-cocoon-01',
        'Wide elegant cocooning living room in late-autumn golden hour, linen sofa and rust wool '
        'throw kept to one side, warm oak, a low lamp and rain beginning on broad windows, '
        'generous empty center floor.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-cocoon-02',
        'Medium rainy-day reading corner with a window covered in slow droplets, closed books '
        'and a steaming tea cup on a small side table, soft boucle chair at the edge and an '
        'unobstructed central frame.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-cocoon-03',
        'Refined close detail of a hand-thrown tea cup steaming beside stacked clothbound books '
        'and a folded knit blanket in warm late-day light, objects framing rather than filling '
        'the center, shallow depth of field.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-cocoon-04',
        'Wide attic lounge at winter blue hour, timber beams, soft lamps, rain tracing the roof '
        'windows and a single reading chair near the wall, calm uncluttered center floor, slow '
        'subtle dolly.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-cocoon-05',
        'Medium Scandinavian-inspired breakfast nook on a foggy autumn morning, muted clay and '
        'oat tones, tea pot and books placed along the window bench, soft diffused light and '
        'clear central aisle.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-cocoon-06',
        'Vertical cozy window alcove during evening rain, amber lamp above, folded plaid and '
        'steaming tea at the lower edge, droplets and distant city bokeh rising behind a tall '
        'clean center composition.' + EMPTY_916,
        '9:16',
    ),
    # Automne européen — forêt, village, marché et pierre mouillée.
    (
        'ambre-europe-01',
        'Wide European beech forest at misty autumn sunrise, copper and russet canopy, leaves '
        'drifting slowly across an empty path, soft shafts of light and an open central route '
        'into the distance.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-europe-02',
        'Wide alpine village after the first snow at violet dusk, timber balconies, stone roofs '
        'and warm windows around an empty village square, mountains fading into mist, slow crane '
        'movement.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-europe-03',
        'Medium view through an elegant small European autumn market before opening at dawn, '
        'wooden stalls with pumpkins, apples and dried flowers confined to the sides, wet paving '
        'and a broad clear center aisle.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-europe-04',
        'Empty old European cobblestone lane immediately after evening rain, ochre façades, '
        'warm window reflections and faint ground mist, no signs, clean central depth and a slow '
        'stabilized walk-through.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-europe-05',
        'Medium view of a quiet mountain village café terrace on a crisp late-autumn afternoon, '
        'folded blankets and copper foliage at the edges, pale sun on stone and a completely '
        'open center foreground.' + EMPTY_169,
        '16:9',
    ),
    (
        'ambre-europe-06',
        'Vertical path through a russet European forest after rain, tall trunks and amber leaves '
        'forming a natural frame, fine mist, glistening ground and an unobstructed center leading '
        'toward distant morning light.' + EMPTY_916,
        '9:16',
    ),
]


LISA_TECH_BASE: list[tuple[str, str, str]] = [
    (
        'lisa-data-01',
        'Wide abstract data landscape in a charcoal-black volume, thin cobalt and warm-white '
        'light streams moving in measured parallel arcs, deep perspective, quiet premium mood '
        'and broad negative space through the center.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-data-02',
        'Medium cinematic view through transparent fiber-optic strands carrying restrained '
        'blue-white pulses like a precise digital river, black glass reflections, slow lateral '
        'parallax and an uncluttered center axis.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-data-03',
        'Top-down view of elegant abstract information flows branching across a matte graphite '
        'surface, a few amber verification pulses among cool white lines, no symbols, balanced '
        'editorial composition and clean center.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-server-01',
        'Wide symmetrical aisle in an immaculate liquid-cooled AI server hall at blue hour, '
        'subtle cyan status lights, dark brushed metal, faint atmospheric depth and a completely '
        'clear center walkway, slow push-in.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-server-02',
        'Medium tracking view beside premium black server racks, tiny white and muted blue '
        'network lights pulsing in calm sequences, restrained reflections and open negative '
        'space in the central third.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-server-03',
        'Wide empty network operations room before dawn, curved dark consoles kept to the edges, '
        'large abstract monitoring surfaces with no legible data, soft slate light and a clear '
        'central presentation zone.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-office-01',
        'Wide minimalist AI research office in Paris at early morning, walnut desk pushed to one '
        'side, one ultra-wide display with an abstract dim interface, concrete and linen textures, '
        'city haze and broad empty center floor.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-office-02',
        'Medium premium home technology studio during light rain, matte graphite shelving, a '
        'closed laptop and small practical lamps along the margins, cool window light balanced '
        'with warm accents and a clean central frame.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-office-03',
        'Wide empty glass meeting room at night overlooking a European skyline, blank translucent '
        'boards and dark furniture at the perimeter, subtle blue reflections, restrained contrast '
        'and an open central axis.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-interface-01',
        'Elegant luminous interface layers floating as thin translucent glass planes in a dark '
        'studio, all glyphs abstract and unreadable, sparse cobalt highlights, slow precise '
        'parallax and generous black negative space.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-interface-02',
        'Medium view of a restrained holographic research dashboard reflected on smoked glass, '
        'soft white diagrams and one muted amber focal pulse, no text, no hands, clear central '
        'visual rhythm and slow rack focus.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-circuit-01',
        'Extreme macro glide across a premium AI accelerator circuit, graphite silicon, copper '
        'traces and tiny cool-white pulses, scientifically plausible detail, shallow depth and '
        'an uncluttered center channel.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-circuit-02',
        'Macro journey above an etched processor architecture resembling a miniature dark city, '
        'sparse blue signals traveling along precise pathways, restrained metallic palette and '
        'clean central route.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-circuit-03',
        'Close view of a silicon wafer under a narrow scanning light, subtle silver, bronze and '
        'deep-blue diffraction moving across microscopic circuits, elegant laboratory realism '
        'and quiet negative space.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-neural-01',
        'Wide stylized neural network suspended in a deep charcoal volume, sparse pearl-white '
        'nodes connected by fine cobalt threads, measured waves of activation, no brain shape, '
        'slow orbital camera and open center depth.' + EMPTY_169,
        '16:9',
    ),
    (
        'lisa-neural-02',
        'Medium flight through a refined three-dimensional inference graph made of translucent '
        'nodes and hair-thin light links, dark navy fog, one restrained amber decision path and '
        'an uncluttered central corridor.' + EMPTY_169,
        '16:9',
    ),
]


def expand_takes(
    prompts: list[tuple[str, str, str]],
    takes: int = TAKES_PER_PROMPT,
) -> list[tuple[str, str, str]]:
    """Décline chaque invite en prises indépendantes et reprenables."""
    return [
        (f'{prompt_id}-take{take:02d}', prompt, ratio)
        for take in range(1, takes + 1)
        for prompt_id, prompt, ratio in prompts
    ]


AMBRE_AUTOMNE = expand_takes(AMBRE_AUTOMNE_BASE)
LISA_TECH = expand_takes(LISA_TECH_BASE)

CAMPAIGN_QUEUES = {
    'ambre-automne': (
        AMBRE_AUTOMNE,
        '16:9',
        Path('~/.codebuddy/media-video/ambre-automne').expanduser(),
        'ambre-',
        3,
    ),
    'lisa-tech': (
        LISA_TECH,
        '16:9',
        Path('~/.codebuddy/media-video/lisa-tech').expanduser(),
        'lisa-',
        3,
    ),
}
