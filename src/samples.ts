// Sample texts so anyone can try the app in one click. The modern ones ("Today" mode) are
// fictional on purpose: no real party, person or place. The History ones are real speeches
// in the public domain (Lincoln 1863, Pankhurst 1913, Roosevelt 1941, a US government work).

export interface Sample {
  label: string;
  text: string;
  history?: boolean; // shown in History mode
}

export const SAMPLES: Sample[] = [
  {
    label: "Council housing plan",
    text: `FOR IMMEDIATE RELEASE: Brookfield Borough Council (fictional)

The Council today approved its "Homes for Brookfield" plan. Over the next five years the Council will build 1,200 new homes on former industrial land near the river. At least 35% will be "affordable housing", meaning rent set at no more than 80% of local market rent. The plan will be paid for by a £40 million loan from the Public Works Loan Board and by selling two council-owned car parks.

Council Leader Sam Ortega said: "This is the biggest house-building programme in Brookfield for a generation. Young families will finally be able to stay in the town they grew up in."

Opposition councillors argued that the riverside land is at risk of flooding and that selling the car parks will hurt local shops. The plan also changes planning rules so that buildings of up to eight storeys are allowed in the riverside zone, up from four. A public consultation on the building heights will run until March.`,
  },
  {
    label: "Campaign speech",
    text: `Speech by candidate Alex Rowan (fictional), Northvale by-election

Friends, for too long Northvale has been forgotten. Our bus routes have been cut in half since 2019. Our high street has lost one shop in every four. And what has Westbridge done about it? Nothing.

If you elect me, I will fight for three things. First, I will bring back the number 12 and number 40 bus routes within my first year. Second, I will push for business rates to be frozen for every shop with fewer than ten staff. Third, I will make sure that every child in Northvale has a school place within two miles of home.

My opponents say we can't afford it. I say we can't afford not to. Northvale pays more in taxes than it gets back, and it's time that changed. On Thursday, vote for a Northvale that works for Northvale.`,
  },
  {
    label: "Bill summary",
    text: `The Shared Scooters (Safety and Parking) Bill — summary (fictional)

Part 1 makes it a requirement for any company renting out electric scooters to hold a licence from the local authority. Licences last two years and can be removed if a company breaks the rules three times in twelve months.

Part 2 sets a top speed of 15.5 mph for rental scooters and requires them to have front and rear lights that switch on automatically.

Part 3 allows local authorities to create "designated parking bays". Scooters left outside a bay may be removed, and the rental company will be charged a fee of up to £100 per scooter. Companies may pass this fee on to the rider.

Part 4 requires riders to be at least 16 years old and to hold a provisional or full driving licence. It does not require riders to wear a helmet, but the Secretary of State may introduce this by regulations after a review in 2028.`,
  },
  {
    label: "Letter to my MP",
    text: `Draft letter to my MP (fictional: the names, numbers and address are made up)

Dear Ms Okafor,

My name is Jordan Patel and I live at 14 Mill Lane, Northvale NV1 4QX. I am writing about the plan to cut the number 40 bus route, which I take to work every day. The council's consultation says the route carries "fewer than 300 passengers a day", but the operator's own figures from last year showed 1,150.

If the route is cut, my journey to the hospital where I work will go from 25 minutes to over an hour. Could you ask the council which figures they used, and whether disabled passengers were consulted as the Equality Act requires?

You can reach me at jordan.patel@example.com or on 07700 900123.

Yours sincerely,
Jordan Patel`,
  },
  {
    label: "Roosevelt, 1941",
    history: true,
    text: `Address to Congress by President Franklin D. Roosevelt, 8 December 1941 (a real historical speech, in the public domain)

Mr. Vice President, Mr. Speaker, members of the Senate and the House of Representatives: Yesterday, December 7th, 1941—a date which will live in infamy—the United States of America was suddenly and deliberately attacked by naval and air forces of the Empire of Japan.

The United States was at peace with that nation, and, at the solicitation of Japan, was still in conversation with its Government and its Emperor looking toward the maintenance of peace in the Pacific. Indeed, one hour after Japanese air squadrons had commenced bombing in the American island of Oahu, the Japanese Ambassador to the United States and his colleague delivered to our Secretary of State a formal reply to a recent American message. And while this reply stated that it seemed useless to continue the existing diplomatic negotiations, it contained no threat or hint of war or of armed attack.

It will be recorded that the distance of Hawaii from Japan makes it obvious that the attack was deliberately planned many days or even weeks ago. During the intervening time the Japanese Government has deliberately sought to deceive the United States by false statements and expressions of hope for continued peace.

The attack yesterday on the Hawaiian Islands has caused severe damage to American naval and military forces. I regret to tell you that very many American lives have been lost. In addition American ships have been reported torpedoed on the high seas between San Francisco and Honolulu.

Yesterday the Japanese Government also launched an attack against Malaya.

Last night Japanese forces attacked Hong Kong.

Last night Japanese forces attacked Guam.

Last night Japanese forces attacked the Philippine Islands.

Last night the Japanese attacked Wake Island.

And this morning the Japanese attacked Midway Island.

Japan has, therefore, undertaken a surprise offensive extending throughout the Pacific area. The facts of yesterday and today speak for themselves. The people of the United States have already formed their opinions and well understand the implications to the very life and safety of our nation.

As Commander-in-Chief of the Army and Navy, I have directed that all measures be taken for our defense.

But always will our whole nation remember the character of the onslaught against us. No matter how long it may take us to overcome this premeditated invasion, the American people in their righteous might will win through to absolute victory.

I believe that I interpret the will of the Congress and of the people when I assert that we will not only defend ourselves to the uttermost but will make it very certain that this form of treachery shall never again endanger us.

Hostilities exist. There is no blinking at the fact that our people, our territory and our interests are in grave danger.

With confidence in our armed forces—with the unbounding determination of our people—we will gain the inevitable triumph—so help us God.

I ask that the Congress declare that since the unprovoked and dastardly attack by Japan on Sunday, December 7th, 1941, a state of war has existed between the United States and the Japanese Empire.`,
  },
  {
    label: "Lincoln, 1863",
    history: true,
    text: `Address by President Abraham Lincoln at Gettysburg, Pennsylvania, 19 November 1863 (a real historical speech, in the public domain)

Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal.

Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this.

But, in a larger sense, we can not dedicate—we can not consecrate—we can not hallow—this ground. The brave men, living and dead, who struggled here, have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember what we say here, but it can never forget what they did here. It is for us the living, rather, to be dedicated here to the unfinished work which they who fought here have thus far so nobly advanced. It is rather for us to be here dedicated to the great task remaining before us—that from these honored dead we take increased devotion to that cause for which they gave the last full measure of devotion—that we here highly resolve that these dead shall not have died in vain—that this nation, under God, shall have a new birth of freedom—and that government of the people, by the people, for the people, shall not perish from the earth.`,
  },
  {
    label: "Pankhurst, 1913",
    history: true,
    text: `Speech by Emmeline Pankhurst, British suffragette, Hartford, Connecticut, 13 November 1913 (excerpt; a real historical speech, in the public domain)

Mrs Hepburn, ladies and gentlemen: Many people come to Hartford to address meetings as advocates of some reform. Tonight it is not to advocate a reform that I address a meeting in Hartford. I do not come here as an advocate, because whatever position the suffrage movement may occupy in the United States of America, in England it has passed beyond the realm of advocacy and it has entered into the sphere of practical politics. It has become the subject of revolution and civil war, and so tonight I am not here to advocate woman suffrage. American suffragists can do that very well for themselves.

I am here as a soldier who has temporarily left the field of battle in order to explain - it seems strange it should have to be explained - what civil war is like when civil war is waged by women. I am not only here as a soldier temporarily absent from the field at battle; I am here - and that, I think, is the strangest part of my coming - I am here as a person who, according to the law courts of my country, it has been decided, is of no value to the community at all: and I am adjudged because of my life to be a dangerous person, under sentence of penal servitude in a convict prison. So you see there is some special interest in hearing so unusual a person address you. I dare say, in the minds of many of you - you will perhaps forgive me this personal touch - that I do not look either very like a soldier or very like a convict, and yet I am both.

Now, first of all I want to make you understand the inevitableness of revolution and civil war, even on the part of women, when you reach a certain stage in the development of a community's life. It is not at all difficult if revolutionaries come to you from Russia, if they come to you from China, or from any other part of the world, if they are men, to make you understand revolution in five minutes, every man and every woman to understand revolutionary methods when they are adopted by men.

[…]

Suppose the men of Hartford had a grievance, and they laid that grievance before their legislature, and the legislature obstinately refused to listen to them, or to remove their grievance, what would be the proper and the constitutional and the practical way of getting their grievance removed? Well, it is perfectly obvious at the next general election, when the legislature is elected, the men of Hartford in sufficient numbers would turn out that legislature and elect a new one: entirely change the personnel of an obstinate legislature which would not remove their grievance. It is perfectly simple and perfectly easy for voting communities to get their grievances removed if they act in combination and make an example of the legislature by changing the composition of the legislature and sending better people to take the place of those who have failed to do justice.

But let the men of Hartford imagine that they were not in the position of being voters at all, that they were governed without their consent being obtained, that the legislature turned an absolutely deaf ear to their demands, what would the men of Hartford do then? They couldn't vote the legislature out. They would have to choose; they would have to make a choice of two evils: they would either have to submit indefinitely to an unjust state of affairs, or they would have to rise up and adopt some of the antiquated means by which men in the past got their grievances remedied. We know what happened when your forefathers decided that they must have representation for taxation, many, many years ago. When they felt they couldn't wait any longer, when they laid all the arguments before an obstinate British government that they could think of, and when their arguments were absolutely disregarded, when every other means had failed, they began by the tea party at Boston, and they went on until they had won the independence of the United States of America. That is what happened in the old days.`,
  },
];
