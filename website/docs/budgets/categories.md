---
spec: ['09']
description: Add, rename, hide, move and delete categories and category groups.
---

# Categories

Categories are grouped into **master categories** (category groups). You manage both on the budget screen. Changing categories needs a connection to your server.

![List of example budget categories](/img/budgets/categories-light.png#light)
![List of example budget categories](/img/budgets/categories-dark.png#dark)

## Add a category group

1. Select **+** next to **Categories** at the top of the category column ("Add new Master Category").
2. A group named "New Master Category" appears at the top. Type its name and select **Done**.

Select **Cancel** to remove the new group again.

## Add a category

1. Hover over a group and select the small **+** ("Add new subcategory").
2. A category named "New Category" appears at the end of the group. Type its name and select **Done**.

You can also create a category while entering a transaction: type a name that doesn't exist in the **Category** field, and Actuality offers to create it.

## Rename a category or group

Select its name to open **Edit category** or **Edit master category**, type the new name and select **Done**.

Names can't be empty, can't contain `:` or `` ` ``, and must be different from the other categories in the same group. A group can't be called "Income", "Hidden Categories" or "Uncategorized Transactions".

## Hide and unhide

Hiding a category keeps its history but takes it out of your budget and out of the category list when you enter transactions.

- To hide a category, select its name and choose **Hide this category**. To hide a whole group with its categories, select the group's name and choose **Hide this Master Category (and its sub-categories)**.
- Hidden categories are totaled in the **Hidden Categories** row at the bottom. To bring one back, hover over that row, select **Unhide**, then select the category or group. **Unhide All** brings back everything.

## Delete a category or group

Select its name and choose **Delete this category** (or **Delete this Master Category (and its sub-categories)**). Actuality tells you what will be lost before you confirm:

- Money budgeted to the category in any month is permanently lost.
- Transactions in the category become uncategorized, so they no longer affect your budget until you categorize them again.

If you only want the category out of the way, hide it instead.

## Reorder and move categories

- **Drag** a category up or down within its group, or into another group. Drag a group to reorder the groups.
- With the keyboard, select a row and press **Alt+↑** or **Alt+↓**.
- Right-click a row, or press **Shift+F10**, for **Move Up**, **Move Down** and **Move to Group…**.

A category can't be moved into a group that already has a category with the same name.

## Expand and collapse groups

Select the arrow next to a group to collapse or expand it. The two buttons next to **Categories** expand or collapse every group at once; with the keyboard, use **Ctrl+→** and **Ctrl+←**. Actuality remembers which groups you collapsed.

## Notes and templates

Select the note icon next to a category or group to add a note. If you use budget templates in Actual's web app, their lines are shown in the note as ordinary text. Actuality doesn't run templates, and leaves them as they are.
