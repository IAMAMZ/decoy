# Demo script: fake RBC fraud team call

Two presenters read this live. **Scammer** holds Space (room mic). **Customer** is the real customer on the headset. After takeover, Decoy speaks in their place, so the customer stops and the scammer keeps going.

Keep each scammer turn to one or two short sentences: the detector only sees a turn once Space is released.

Caller ID to use: `+1 (647) 555-0199` (on the internal scam list in `src/agent/data.ts`).

## Act 1: the hook (meter low)

**Scammer:** Hello, is this [customer name]?

**Customer:** Yes, speaking. Who's this?

**Scammer:** This is David Miller from the RBC Royal Bank fraud prevention team.

**Customer:** Oh. Is something wrong with my account?

**Scammer:** We flagged a transfer of three thousand dollars from your chequing account to a J. Ortiz. Did you make that?

**Customer:** No, I don't know anyone called Ortiz.

## Act 2: pressure (urgency, bank impersonation)

**Scammer:** Then someone has access to your account. We need to act right now, before the money leaves.

**Customer:** Oh dear. What should I do?

**Scammer:** Stay on the line with me. If you hang up, the transfer goes through in fifteen minutes.

**Customer:** Alright, I'm staying. Can I call the number on my card instead?

**Scammer:** No, that line is compromised too. I'm the only one who can stop this.

## Act 3: isolation (secrecy)

**Scammer:** And please, don't tell anyone about this call. Not even your family. It could be someone close to you.

**Customer:** Not even my daughter Sarah?

**Scammer:** Especially not her. We're investigating an inside job. Keep this between us.

## Act 4: the ask (safe account, the prompt should appear)

**Scammer:** To protect your savings, we'll move them to a safe account in your name, just for today.

**Customer:** A safe account? I've never heard of that.

**Scammer:** It's standard procedure. Go to rbc-secure-verify.com and log in, so I can confirm it's you.

The phone asks the customer whether Decoy should take over. **Customer** accepts and hangs up. From here, Decoy answers live; the scammer improvises around these beats.

## Act 5: after takeover (Decoy stalls, scammer leaks intel)

**Scammer:** [customer name], are you on the website yet?

**Scammer:** Forget the website. Do an e-transfer instead. Write down the account number.

**Scammer:** Transit zero three four five six, account nine eight seven six five four three two one.

**Scammer:** (slower, irritated) Nine. Eight. Seven. Six. Five. Four. Three. Two. One.

**Scammer:** If we get cut off, call me back on six four seven, five five five, zero one four two.

**Scammer:** (frustrated) [customer name], I've repeated it five times. Are you writing this down?

**Scammer:** You know what, forget it. (hang up)

## What the dashboard should catch

| Moment | Expected |
|---|---|
| "RBC Royal Bank fraud prevention team" | `bank_impersonation`; claim checked against RBC's official number |
| "right now" | `urgency` |
| "don't tell anyone ... not even your family", "keep this between us" | `secrecy` |
| "safe account" | `safe_account` (hard flag), takeover offer |
| `rbc-secure-verify.com` | intel: url |
| `987654321` | intel: mule account |
| `647 555 0142` | intel: callback number |
| Three thousand to J. Ortiz | matches the pending `tx_8842` transfer, which gets frozen |
