---
spec: ['15']
description: How Actuality's Money Age is worked out, and how to read it.
---

# Money Age

Money Age, on the [Summary](./the-reports.md#summary) report, tells you how long, on average, your money sat in your accounts before you spent it. The older it is, the further ahead you are: a Money Age of 30 days means you're spending money you received about a month ago.

In Actuality's own words (also shown under **About Money Age** in the app):

> Money Age estimates the calendar-day age of known-age money when spent. It uses FIFO funding across available history, counts card purchases on their purchase date, and shows what share of spending had known-age funding. Its method differs from other budgeting apps' age-of-money measures.

## How it's worked out

Actuality follows every dollar through your **open budget accounts**:

1. Money coming in (income, refunds, and transfers from off-budget accounts) is added to a queue, dated the day it arrived.
2. Each time you spend, the money is taken from the front of the queue: the oldest money first ("first in, first out").
3. The age of each dollar spent is the number of days between when it arrived and when it was spent. Each month's Money Age is the average age of the money spent that month.

Some details:

- **Credit card purchases count when you make them**, not when you pay the card. Paying the card, and other transfers between your budget accounts, aren't spending.
- **Starting balances have no known age**, because Actuality can't know when that money arrived. It's spent first, before any money with a known date.
- Money Age uses all of your history, whatever timeframe you choose. The timeframe only decides which months are shown.
- The report filters don't change it.

## Reading the result

- **Partial** means some of the month's spending was paid for with money of unknown age, such as a starting balance. The figure then covers only the spending whose age is known, and the coverage percentage shows how much of the month's spending that is. Partial results are common in a new budget and go away as your history grows.
- A month with no spending has no Money Age.

Money Age is Actuality's own measure. Other budgeting apps have similar measures, worked out differently, so the numbers won't match.
