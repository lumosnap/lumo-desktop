/**
 * AI tag vocabulary. Slugs are shared with the web app; never rename one (add a new slug instead).
 * Prompts only feed scripts/build-tag-vectors.mjs; rerun it after editing them.
 */

export type TagCategory = 'events' | 'people' | 'shots' | 'things' | 'moments' | 'settings'

export interface TagDef {
  slug: string
  category: TagCategory
  prompts: string[]
}

const t = (slug: string, category: TagCategory, ...prompts: string[]): TagDef => ({
  slug,
  category,
  prompts
})

export const TAGS: TagDef[] = [
  // events
  t(
    'getting-ready',
    'events',
    'a photo of a bride getting ready, having her makeup done',
    'a photo of a groom getting dressed before the wedding',
    'a photo of a bride getting her hair and makeup done in a room'
  ),
  t(
    'haldi',
    'events',
    'a photo of a haldi ceremony with yellow turmeric paste',
    'a photo of people applying yellow turmeric to the bride',
    'a photo of a haldi function with yellow clothes and marigolds'
  ),
  t(
    'mehendi',
    'events',
    'a photo of a mehendi ceremony',
    'a photo of a henna party before an Indian wedding',
    'a photo of women applying henna at a mehndi function'
  ),
  t(
    'sangeet',
    'events',
    'a photo of a sangeet night with music and dancing',
    'a photo of an Indian wedding sangeet party on a stage',
    'a photo of family performing a dance at a sangeet'
  ),
  t(
    'engagement',
    'events',
    'a photo of an engagement ceremony',
    'a photo of a couple exchanging rings at their engagement',
    'a photo of an engagement party'
  ),
  t(
    'baraat',
    'events',
    'a photo of a baraat, the groom arriving on a horse',
    'a photo of a wedding procession with the groom and dancing relatives',
    'a photo of the groom on a decorated horse at an Indian wedding'
  ),
  t(
    'ceremony',
    'events',
    'a photo of a wedding ceremony',
    'a photo of the main wedding rituals with the bride and groom',
    'a photo of guests watching a wedding ceremony'
  ),
  t(
    'varmala',
    'events',
    'a photo of a varmala, the bride and groom exchanging flower garlands',
    'a photo of a jaimala ceremony at an Indian wedding',
    'a photo of a couple putting garlands on each other'
  ),
  t(
    'pheras',
    'events',
    'a photo of the pheras, the couple walking around the sacred fire',
    'a photo of the saat phere at a Hindu wedding',
    'a photo of the bride and groom circling a fire under a mandap'
  ),
  t(
    'thali',
    'events',
    "a photo of the groom tying the thali around the bride's neck",
    'a photo of a mangalsutra being tied at a South Indian wedding',
    'a photo of a Kerala wedding thali ceremony'
  ),
  t(
    'nikah',
    'events',
    'a photo of a nikah, a Muslim wedding ceremony',
    'a photo of a Muslim bride and groom signing the nikah',
    'a photo of an imam conducting a nikah'
  ),
  t(
    'church-wedding',
    'events',
    'a photo of a Christian wedding in a church',
    'a photo of a bride in a white gown walking down the church aisle',
    'a photo of a priest marrying a couple at the altar'
  ),
  t(
    'reception',
    'events',
    'a photo of a wedding reception',
    'a photo of a couple greeting guests at their reception',
    'a photo of an evening wedding reception party'
  ),

  // people
  t(
    'bride',
    'people',
    'a photo of the bride',
    'a photo of a bride in her wedding outfit',
    'a photo of an Indian bride in a saree or lehenga'
  ),
  t(
    'groom',
    'people',
    'a photo of the groom',
    'a photo of a groom in a sherwani or suit',
    'a photo of a bridegroom'
  ),
  t(
    'couple',
    'people',
    'a photo of the bride and groom together',
    'a photo of a newly married couple',
    'a romantic portrait of a couple'
  ),
  t(
    'family',
    'people',
    'a photo of a family',
    'a family portrait at a wedding',
    'a photo of parents and relatives with the couple'
  ),
  t(
    'group-photo',
    'people',
    'a group photo of many people',
    'a photo of a large group of people posing together',
    'a posed group photo at a wedding'
  ),
  t(
    'kids',
    'people',
    'a photo of children',
    'a photo of kids playing',
    'a photo of a little girl or boy'
  ),
  t(
    'elders',
    'people',
    'a photo of elderly people',
    'a photo of grandparents',
    'a photo of an old man or an old woman'
  ),
  t(
    'friends',
    'people',
    'a photo of friends having fun together',
    'a photo of bridesmaids or groomsmen',
    'a photo of a group of young friends'
  ),
  t(
    'guests',
    'people',
    'a photo of wedding guests',
    'a photo of guests seated in the audience',
    'a photo of people attending a wedding'
  ),

  // shots
  t(
    'portrait',
    'shots',
    'a portrait photo of a person',
    'a posed portrait with a blurred background',
    'a professional portrait photo'
  ),
  t(
    'candid',
    'shots',
    'a candid photo of people',
    'an unposed candid moment',
    'a natural candid shot of people talking'
  ),
  t(
    'close-up',
    'shots',
    'a close-up photo of a face',
    'a tight close-up shot',
    'a macro close-up photo'
  ),
  t(
    'details',
    'shots',
    'a detail shot of wedding accessories',
    'a photo of small decorative details',
    'a still life photo of objects'
  ),
  t(
    'black-and-white',
    'shots',
    'a black and white photo',
    'a monochrome photo',
    'a grayscale photograph'
  ),
  t(
    'silhouette',
    'shots',
    'a silhouette photo of people against the light',
    'a photo of dark silhouettes against a bright sky',
    'a backlit silhouette'
  ),
  t(
    'aerial',
    'shots',
    'an aerial photo taken by a drone',
    'a top-down drone shot',
    "a bird's eye view photo"
  ),

  // things
  t(
    'rings',
    'things',
    'a photo of wedding rings',
    'a close-up photo of an engagement ring',
    'a photo of a ring on a finger'
  ),
  t(
    'jewellery',
    'things',
    'a photo of gold jewellery',
    'a photo of a necklace and earrings',
    'a photo of bridal jewelry'
  ),
  t(
    'mehendi-hands',
    'things',
    'a photo of hands with henna designs',
    'a close-up photo of mehndi patterns on hands',
    "a photo of the bride's hands covered in henna"
  ),
  t(
    'bridal-outfit',
    'things',
    'a photo of a bridal lehenga or saree',
    'a photo of a wedding dress',
    "a photo of a bride's outfit hanging or laid out"
  ),
  t(
    'flowers',
    'things',
    'a photo of flowers',
    'a photo of a bouquet',
    'a photo of marigold and rose flower decorations'
  ),
  t(
    'decor',
    'things',
    'a photo of wedding decorations',
    'a photo of a decorated hall with lights and drapes',
    'a photo of table decor and centerpieces'
  ),
  t(
    'stage',
    'things',
    'a photo of a decorated wedding stage',
    'a photo of a mandap',
    'a photo of a stage with a backdrop and chairs for the couple'
  ),
  t(
    'venue',
    'things',
    'a photo of a wedding venue',
    'a photo of an empty banquet hall',
    'a wide photo of the venue and its architecture'
  ),
  t('food', 'things', 'a photo of food', 'a photo of a buffet', 'a photo of people eating a meal'),
  t(
    'sadya',
    'things',
    'a photo of a Kerala sadya served on a banana leaf',
    'a photo of a traditional meal on a banana leaf',
    'a photo of guests eating sadya at a South Indian wedding'
  ),
  t(
    'cake',
    'things',
    'a photo of a wedding cake',
    'a photo of a couple cutting a cake',
    'a photo of a tiered cake'
  ),
  t(
    'drinks',
    'things',
    'a photo of drinks',
    'a photo of glasses of wine or champagne',
    'a photo of cocktails at a bar'
  ),
  t(
    'invitation-card',
    'things',
    'a photo of a wedding invitation card',
    'a photo of printed wedding stationery',
    'a photo of an invitation with text'
  ),

  // moments
  t(
    'dance',
    'moments',
    'a photo of people dancing',
    'a photo of a couple dancing',
    'a photo of a dance floor at a party'
  ),
  t(
    'laughing',
    'moments',
    'a photo of people laughing',
    'a photo of a person laughing out loud',
    'a photo of a big happy smile'
  ),
  t(
    'hugging',
    'moments',
    'a photo of people hugging',
    'a photo of an embrace',
    'a photo of two people holding each other'
  ),
  t(
    'kiss',
    'moments',
    'a photo of a couple kissing',
    'a photo of a kiss',
    'a photo of a kiss on the cheek or forehead'
  ),
  t(
    'toast',
    'moments',
    'a photo of people raising glasses for a toast',
    'a photo of a champagne toast',
    'a photo of clinking glasses'
  ),
  t(
    'speech',
    'moments',
    'a photo of a person giving a speech with a microphone',
    'a photo of someone speaking at a podium',
    'a photo of a wedding speech'
  ),
  t(
    'performance',
    'moments',
    'a photo of a stage performance',
    'a photo of musicians playing',
    'a photo of a singer or band performing'
  ),
  t(
    'procession',
    'moments',
    'a photo of a procession of people walking',
    'a photo of a bridal entry walking down an aisle',
    'a photo of a parade with drums'
  ),
  t(
    'rituals',
    'moments',
    'a photo of a religious ritual',
    'a photo of a priest performing a puja',
    'a photo of people performing traditional rites'
  ),
  t(
    'sacred-fire',
    'moments',
    'a photo of a sacred fire',
    'a photo of a havan fire ritual',
    'a photo of flames in a fire pit at a ceremony'
  ),
  t(
    'tears',
    'moments',
    'a photo of a person crying',
    'a photo of an emotional moment with tears',
    'a photo of someone wiping away tears'
  ),

  // settings
  t(
    'outdoor',
    'settings',
    'a photo taken outdoors',
    'a photo outside in daylight',
    'an outdoor photo with sky and trees'
  ),
  t(
    'indoor',
    'settings',
    'a photo taken indoors',
    'a photo inside a room or hall',
    'an indoor photo with artificial light'
  ),
  t(
    'night',
    'settings',
    'a photo taken at night',
    'a photo with a dark night sky and lights',
    'a nighttime photo'
  ),
  t(
    'beach',
    'settings',
    'a photo at a beach',
    'a photo by the sea with sand',
    'a photo on the shore with ocean waves'
  ),
  t(
    'garden',
    'settings',
    'a photo in a garden',
    'a photo on a green lawn with plants',
    'a photo in a park'
  ),
  t(
    'temple',
    'settings',
    'a photo at a Hindu temple',
    'a photo in front of a temple',
    'a photo inside a temple with lamps'
  ),
  t(
    'church',
    'settings',
    'a photo of a church',
    'a photo inside a church with pews',
    'a photo of a church building'
  )
]

const LABELS: Record<string, string> = {
  'black-and-white': 'Black & white',
  'close-up': 'Close-up'
}

/** Human label for a slug, vocabulary or custom: 'group-photo' -> 'Group photo'. */
export const tagLabel = (slug: string): string =>
  LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')
