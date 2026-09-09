/* Messages a person actually sends to a website builder, each labelled with
 * what a careful reader would say it means.
 *
 * Four sets, kept apart on purpose. The rules were written against `corpus`,
 * then each later set was written before being run and used once to find what
 * the rules did not yet know. That is the only way the numbers mean anything:
 * a classifier tuned and measured on one list will score whatever you like.
 *
 * `page` is whether a page already exists. The same words mean different things
 * before and after there is something to edit — "make it better" is a hopeless
 * edit and a perfectly ordinary opening brief.
 *
 * Add to these when the classifier gets something wrong in real use. A message
 * that was misread once is the most valuable kind of test there is.
 */

/** Written first; the rules were developed against this set. */
export const CORPUS = [
  ["make the hero headline bigger", true, "edit"],
  ["change the footer text to 2026", true, "edit"],
  ["darker header please", true, "edit"],
  ["move the pricing section above testimonials", true, "edit"],
  ["remove the third card", true, "edit"],
  ["centre the heading", true, "edit"],
  ["the button should be blue", true, "edit"],
  ["swap the logo for the one I attached", true, "edit"],
  ["add a contact form under the hero", true, "edit"],
  ["make it darker", true, "edit"],
  ["smaller", true, "edit"],
  ["use Inter instead", true, "edit"],
  ["the nav is too cramped", true, "edit"],
  ["fix the spacing between the cards", true, "edit"],
  ["make it better for mobile", true, "edit"],
  ["fix it so the form actually submits", true, "edit"],
  ["I don't want the gradient anymore", true, "edit"],
  ["can you make the header sticky?", true, "edit"],
  ["drop the testimonials and tighten the footer", true, "edit"],
  ["make the CTA green and move it up", true, "edit"],
  ["build me a new landing page for a bakery", true, "new_project"],
  ["start over with a portfolio site", true, "new_project"],
  ["scrap this and make a site for my dental clinic", true, "new_project"],
  ["make me a landing page for my law firm", true, "new_project"],
  ["I want a site for my coffee shop with a hero, menu, and contact form", true, "new_project"],
  ["create a completely different page about hiking tours", true, "new_project"],
  ["from scratch: a SaaS pricing page", true, "new_project"],
  ["forget this one, build a photography portfolio", true, "new_project"],
  ["build me an online store", false, "new_project"],
  ["a landing page for my gym", false, "new_project"],
  ["make it better", false, "new_project"],
  ["portfolio site with a projects grid", false, "new_project"],
  ["what font is the heading using?", true, "question"],
  ["why is the hero so tall?", true, "question"],
  ["how many sections does this page have?", true, "question"],
  ["does this work on mobile?", true, "question"],
  ["which colour is the CTA?", true, "question"],
  ["is the form wired up to anything?", true, "question"],
  ["what's the padding on the cards?", true, "question"],
  ["can you explain the layout?", true, "question"],
  ["tell me what the background colour is", true, "question"],
  ["any idea why the nav overlaps on small screens?", true, "question"],
  ["undo that", true, "revert"],
  ["revert the last change", true, "revert"],
  ["go back to the previous version", true, "revert"],
  ["put it back how it was", true, "revert"],
  ["undo", true, "revert"],
  ["make it better", true, "clarify"],
  ["improve it", true, "clarify"],
  ["fix it", true, "clarify"],
  ["make it pop", true, "clarify"],
  ["this looks bad", true, "clarify"],
  ["do better", true, "clarify"],
  ["why is the button grey, and can you make it blue?", true, "edit"],
  ["undo the footer change and make the header taller", true, "revert"],
  ["add a pricing section like the one on stripe.com", true, "edit"],
  ["the hero, the nav and the footer all need more padding", true, "edit"],
  ["change the copy: 'Get started' should read 'Start free'", true, "edit"],
  ["can you add a FAQ with five questions", true, "edit"],
  ["what would make this convert better?", true, "question"],
  ["I need this to look like a fintech product, not a blog", true, "edit"],
];

/** Written before being run. Exposed the missing removal and discard signals. */
export const HOLDOUT = [
  ["get rid of the sidebar", true, "edit"],
  ["I don't want the animation anymore", true, "edit"],
  ["no longer need the newsletter box", true, "edit"],
  ["lose the second CTA", true, "edit"],
  ["make a completely different site about scuba diving", true, "new_project"],
  ["totally different page, this time for a bookshop", true, "new_project"],
  ["throw this away and start again", true, "new_project"],
  ["an ecommerce store for handmade candles", false, "new_project"],
  ["go back to using Inter for the headings", true, "edit"],
  ["restore the old hero image", true, "revert"],
  ["this needs to look like a bank, not a startup", true, "edit"],
  ["it should feel more premium", true, "edit"],
  ["how do I publish this?", true, "question"],
  ["are the images optimised?", true, "question"],
  ["what's in the footer right now", true, "question"],
  ["it's ugly", true, "clarify"],
  ["not great", true, "clarify"],
  ["sort it out", true, "clarify"],
  ["shift the testimonials below pricing and shrink the hero", true, "edit"],
  ["can you explain why the CTA is above the fold?", true, "question"],
];

/** Adversarial. Caught "scrap the last thing you did" being read as a discard. */
export const BLIND = [
  ["bump the font size on the nav links", true, "edit"],
  ["the pricing table needs a fourth tier", true, "edit"],
  ["swap those two sections around", true, "edit"],
  ["kill the animation on scroll", true, "edit"],
  ["everything is too close together", true, "edit"],
  ["I'd like the header to match the footer", true, "edit"],
  ["nah, do a different one — a wedding photographer site", true, "new_project"],
  ["let's do a fresh page for a food truck business", true, "new_project"],
  ["wipe it and build a consultancy homepage", true, "new_project"],
  ["a booking site for a barber shop", false, "new_project"],
  ["who wrote this copy?", true, "question"],
  ["is there a mobile breakpoint in here", true, "question"],
  ["how tall is the hero section?", true, "question"],
  ["what happens when someone submits the form", true, "question"],
  ["scrap the last thing you did", true, "revert"],
  ["undo please", true, "revert"],
  ["rubbish", true, "clarify"],
  ["can you just make it good", true, "clarify"],
  ["needs work", true, "clarify"],
  ["why is it slow and can you speed it up?", true, "edit"],
  ["move the logo left, make the nav sticky, and drop the banner", true, "edit"],
  ["I hate the colours", true, "clarify"],
];

/** Written last. Only one change was made after seeing it: REVERT_NAMED. */
export const FINAL = [
  ["can we lose the stock photo in the hero", true, "edit"],
  ["the testimonials feel cramped on tablet", true, "edit"],
  ["give the buttons rounded corners", true, "edit"],
  ["headline copy should mention free shipping", true, "edit"],
  ["reorder the nav: pricing before features", true, "edit"],
  ["swap the palette to something warmer", true, "edit"],
  ["knock the hero height down a bit", true, "edit"],
  ["start fresh — a page for a yoga studio", true, "new_project"],
  ["actually, build something else entirely: a recipe blog", true, "new_project"],
  ["bin this and do a real estate listing site", true, "new_project"],
  ["landing page for a dog grooming service", false, "new_project"],
  ["where does the contact form send to?", true, "question"],
  ["do the cards have a hover state", true, "question"],
  ["what size is the logo", true, "question"],
  ["can you tell me which fonts are loaded?", true, "question"],
  ["roll that back", true, "revert"],
  ["undo the last two changes", true, "revert"],
  ["put the old footer back", true, "revert"],
  ["it's not working for me", true, "clarify"],
  ["something feels off", true, "clarify"],
  ["make it more like apple", true, "edit"],
  ["I don't love the hero but keep the rest", true, "clarify"],
  ["tighten everything up and make the CTA louder", true, "edit"],
  ["is this responsive, and if not can you fix it?", true, "edit"],
];

/* Undoing, which had no cases at all until somebody asked whether a revert
 * charges — 127 messages and not one of them exercised the path that reverses
 * a person's page. The gap is worth more than the cases: a rule with no test is
 * a rule nobody notices breaking.
 *
 * The compound ones are the interesting half. "undo that and make the header
 * taller" is deliberately a revert rather than an edit: the undo has to happen
 * first, and what remains can be asked for again on the restored page. Doing
 * the edit against the version being thrown away would be exactly wrong, and
 * doing both in one turn would charge for a change somebody might not want once
 * they see the old page come back.
 *
 * Every one of these must be decided by the rules. A revert that reaches the
 * router costs a model call to answer a question a regex already settled — and
 * it is the one intent where being slow is least forgivable, because the
 * person is undoing something they did not want. */
export const REVERTS = [
  ["undo that", true, "revert"],
  ["undo the last change", true, "revert"],
  ["revert", true, "revert"],
  ["roll back the last thing you did", true, "revert"],
  ["put it back", true, "revert"],
  ["go back to the previous version", true, "revert"],
  ["go back to how it was", true, "revert"],
  ["put the old footer back", true, "revert"],

  /* Compound: an undo carrying a follow-up instruction. Revert wins, and the
     rest is the person's to ask for again. */
  ["undo that and make the header taller", true, "revert"],
  ["revert the last change and use a lighter blue", true, "revert"],
  ["roll back and then add a contact form", true, "revert"],

  /* Not reverts, and the distinction is the whole reason REVERT_NAMED is
     written the way it is. "Put the logo back on the left" is a move. */
  ["put the logo back on the left", true, "edit"],
  ["restore the original spacing on the hero", true, "revert"],
];

export const SETS = { corpus: CORPUS, holdout: HOLDOUT, blind: BLIND, final: FINAL, reverts: REVERTS };
