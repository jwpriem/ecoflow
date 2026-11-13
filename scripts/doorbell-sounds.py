# Makes the doorbell sounds in public/sounds: python3 scripts/doorbell-sounds.py <dir>, then ffmpeg -i x.wav -ac 1 -b:a 128k x.mp3
import numpy as np, wave, sys, os
SR=44100
out=sys.argv[1]
def note(name):
    names={'C':-9,'C#':-8,'D':-7,'D#':-6,'E':-5,'F':-4,'F#':-3,'G':-2,'G#':-1,'A':0,'A#':1,'B':2}
    n=name[:-1]; o=int(name[-1])
    return 440*2**((names[n]+12*(o-4))/12)
def buf(d): return np.zeros(int(SR*d))
def add(b,sig,t):
    i=int(t*SR); j=min(len(b),i+len(sig)); b[i:j]+=sig[:j-i]
def bell(f,dur=2.0,amp=1.0,partials=((1,1,1.1),(2,.45,.6),(3,.2,.35),(4.2,.12,.25),(.5,.15,1.4))):
    t=np.arange(int(SR*dur))/SR; att=np.minimum(1,t/0.004)
    return amp*att*sum(a*np.exp(-t/d)*np.sin(2*np.pi*f*r*t) for r,a,d in partials)
def tubular(f,dur=3.0,amp=1.0):
    return bell(f,dur,amp,((1,1,1.8),(2.76,.5,.9),(5.4,.25,.5),(8.93,.12,.3)))
def marimba(f,dur=.8,amp=1.0):
    return bell(f,dur,amp,((1,1,.35),(4,.35,.08),(10,.1,.03)))
def organ(f,dur,amp=1.0):
    t=np.arange(int(SR*dur))/SR
    env=np.minimum(1,t/0.03)*np.minimum(1,(dur-t)/0.08)
    vib=1+0.004*np.sin(2*np.pi*5.5*t)
    ph=2*np.pi*f*np.cumsum(vib)/SR
    s=sum(a*np.sin(ph*h) for h,a in ((1,1),(2,.6),(3,.35),(4,.25),(6,.12),(8,.08),(0.5,.5)))
    return amp*env*s
def jingle(dur=.25,amp=.3,seed=0):
    rng=np.random.default_rng(seed); t=np.arange(int(SR*dur))/SR
    n=rng.standard_normal(len(t))
    # crude high-pass: difference
    n=np.diff(n,prepend=0)
    s=sum(np.sin(2*np.pi*f*t+rng.random()*6) for f in (4100,5300,6700,7900))*0.3
    return amp*(n*0.5+s)*np.exp(-t/0.07)
def save(b,name):
    b=b/np.max(np.abs(b))*0.89
    p=os.path.join(out,name+'.wav')
    with wave.open(p,'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((b*32767).astype('<i2').tobytes())

# 1 Westminster: E5 G#5 F#5 B4, then B4 F#5 G#5 E5 (doorbell half)
b=buf(4.6)
for i,n in enumerate(['G#4','E4','F#4','B3','B3','F#4','G#4','E4']):
    add(b,tubular(note(n)*2,2.2 if i<7 else 2.4,.6),0.05+i*0.5+(0.25 if i>=4 else 0))
save(b,'westminster')
# 2 Three tones up: C5 E5 G5
b=buf(2.6)
for i,n in enumerate(['C5','E5','G5']): add(b,bell(note(n),2.0,.5),0.05+i*0.32)
save(b,'drie-tonen')
# 3 Old-fashioned ring bell: clapper hits 18/s for 1.4 s
b=buf(2.2)
for k in range(int(1.4*18)):
    add(b,bell(1180,0.9,.35,((1,1,.5),(2.32,.6,.3),(4.1,.35,.15),(6.3,.2,.08))),0.02+k/18)
save(b,'ouderwets')
# 4 Cheerful marimba: G4 C5 E5 G5 E5 G5(c6?)
b=buf(2.2)
for i,(n,t) in enumerate([('G4',0),('C5',.13),('E5',.26),('G5',.39),('E5',.62),('C6',.78)]):
    add(b,marimba(note(n),.9,.6),0.03+t)
save(b,'vrolijk')
# Halloween: Toccata in D minor opening on organ (A G A, G F E D C# D) + low D drone
b=buf(5.6)
seq=[('A5',.12),('G5',.12),('A5',1.0),('G5',.11),('F5',.11),('E5',.11),('D5',.11),('C#5',.6),('D5',1.6)]
t=0.05
for n,d in seq:
    add(b,organ(note(n),d+0.05,.35),t); add(b,organ(note(n)/2,d+0.05,.25),t); t+=d+0.04
add(b,organ(note('D2'),t-1.5,.35),1.7)
save(b,'halloween')
# Christmas, Home Alone feel: the Carol of the Bells ostinato (Leontovych, 1916, public domain) on celesta and
# glockenspiel over sleigh bells, warm strings and the descending bass, ending on a ringing G minor chord
def celesta(f,dur=1.2,amp=1.0):
    return bell(f,dur,amp,((1,1,.55),(2,.25,.25),(4,.12,.12),(0.5,.06,.6)))
def strings(f,dur,amp=1.0):
    t=np.arange(int(SR*dur))/SR
    env=np.minimum(1,t/0.35)*np.minimum(1,(dur-t)/0.6)
    s=0
    for det in (-0.004,0,0.005):
        ph=2*np.pi*f*(1+det)*t+0.003*np.sin(2*np.pi*5*t)*2*np.pi
        s=s+sum(np.sin(ph*h)/h**1.6 for h in range(1,8))
    return amp*env*s/3
bar=0.72
b=buf(7.2)
motif=[('A#5',.25),('A5',.125),('A#5',.125),('G5',.25)]
for k in range(6):
    t=0.05+k*bar
    for n,d in motif:
        add(b,celesta(note(n),1.0,.5),t)
        if k>=2: add(b,celesta(note(n)*2,.6,.15),t)
        t+=d*bar/.75
# strings enter on bar 3: G minor over the falling bass G F Eb D
for k,(bass,chord) in enumerate([('G3',['D4','G4','A#4']),('F3',['D4','F4','A#4']),('D#3',['D#4','G4','A#4']),('D3',['D4','F#4','A4'])]):
    t=0.05+(2+k)*bar
    add(b,strings(note(bass),bar+0.25,.32),t)
    for n in chord: add(b,strings(note(n),bar+0.25,.12),t)
end=0.05+6*bar
for n in ['G3','D4','G4','A#4','D5']: add(b,strings(note(n),1.9,.14),end)
for n in ['G5','A#5','D6','G6']: add(b,celesta(note(n),2.0,.3),end)
for k in range(int(end/(bar/6))): add(b,jingle(.25,.22 if k%3 else .35,k),0.05+k*bar/6)
save(b,'kerst')
