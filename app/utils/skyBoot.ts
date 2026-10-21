/**
 * Runs inline in <head> before the first paint (see nuxt.config.ts), so the page never flashes the
 * wrong sky and iOS picks the right status bar. iOS reads `apple-mobile-web-app-status-bar-style`
 * once, when the Home Screen app launches:
 *   night → black-translucent: white status text over our own dark canvas
 *   day   → default: dark status text
 * If the sun comes up while a night-launched app stays open, the status text stays white; main.css
 * then keeps a polder-night band behind it (html[data-statusbar='translucent']).
 *
 * It writes both metas itself: Nuxt places inline scripts ahead of configured metas, so there is
 * nothing to update yet when this runs. Plain ES5 in a string because it is inlined. The math is
 * `sunPosition` from utils/sun.ts for Waddinxveen; tests/skyBoot.test.ts keeps the two in step.
 * plugins/sky.client.ts takes over once the app is running.
 */
export const SKY_BOOT = `(function(){try{
var R=Math.PI/180,d=Date.now()/864e5-10957.5,g=(357.529+0.98560028*d)*R,q=280.459+0.98564736*d,
L=(q+1.915*Math.sin(g)+0.02*Math.sin(2*g))*R,e=(23.439-0.00000036*d)*R,
ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L))/R,dec=Math.asin(Math.sin(e)*Math.sin(L)),
gm=(((18.697374558+24.06570982441908*d)%24)+24)%24,ha=((((gm*15+4.651-ra+180)%360)+360)%360)-180,
la=52.035*R,alt=Math.asin(Math.sin(la)*Math.sin(dec)+Math.cos(la)*Math.cos(dec)*Math.cos(ha*R))/R,
night=alt<=-6,h=document.documentElement;
h.dataset.sky=night?'night':'day';
if(night)h.dataset.statusbar='translucent';
function meta(n,c){var m=document.createElement('meta');m.setAttribute('name',n);m.setAttribute('content',c);document.head.appendChild(m)}
meta('apple-mobile-web-app-status-bar-style',night?'black-translucent':'default');
meta('theme-color',night?'#16262e':'#e6ecee');
}catch(_){}})()`
