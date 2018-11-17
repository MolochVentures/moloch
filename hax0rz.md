> https://github.com/MolochVentures/moloch/blob/master/contracts/Moloch.sol#L200-L204
> - missing re-assignment

correct

> https://github.com/MolochVentures/moloch/blob/master/contracts/GuildBank.sol#L53
> - malicious members can DoS with malicious tokens
> - diluted shares could mean withdrawals are always 0

So because new tokens are only added as part of new membership proposals and voted on, members have a chance to inspect the tokens being offered as tribute and vote not to accept malicious tokens, which is the defense here. 
Not sure what you mean by "diluted shares could mean withdrawals are always 0" though. Could you elaborate?

> https://github.com/MolochVentures/moloch/blob/master/contracts/Moloch.sol#L176
> - malicious members can DoS proposal queue

They can, and the idea is that it would cost them $5,000 each time, and each time they do the funds would be locked up for longer and longer. If someone does this then our plan is just to leave and take all our money with us, and form a new DAO with a higher cost or some other form of malicious-member-proposal-spam protection.

> https://github.com/MolochVentures/moloch/blob/master/contracts/Moloch.sol#L227
> - this line seems like it'll throw most of the time, unless `proposalQueue.length - (pendingProposals+1) > votingPeriodLength`

I didn't realize the behavior of `SafeMath.sub` was to throw on over/underflow. I thought it would set it to the edge value (e.g. 0 in this case). I'll need to fix that. 

> - why not just calculate the votes upon processing a proposal? that means you don't need the hacky 'update active proposals' code

I didn't want to force whoever calls process proposal to have to loop over all the voters and count their votes, especially because if the number of voters gets too large. But I suppose realistically that if we're only doing 1-2 proposals per day, the max expected number of voters in 1 year will be ~300. Then again, this would simplify things a lot, and I don't think the gas cost of storage lookup + addition is that expensive. I'll try it out. 

> https://github.com/MolochVentures/moloch/blob/master/contracts/Moloch.sol#L228
> https://github.com/MolochVentures/moloch/blob/master/contracts/Moloch.sol#L258
> - how does this even compile? you've reused the variable `i`

I hadn't tried compiling since I made some updates, TODO

> - assuming it does compile, now `i` won't be `0` at the start of the loop

Oh duh, that needs to be a different variable. 
