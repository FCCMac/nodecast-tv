/**
 * Windowed vertical list.
 *
 * Renders only `visibleCount` DOM rows and reuses them as the focused
 * index moves, rather than creating one element per item - the 2019 TV's
 * CPU struggles with large DOM trees, and some categories have 1000+
 * channels.
 */
(function () {

    function List(containerEl, opts) {
        this.el = containerEl;
        this.itemHeight = opts.itemHeight;
        this.visibleCount = opts.visibleCount;
        this.renderRow = opts.renderRow; // (item, rowEl, index, isFocused) => void
        this.onEmpty = opts.onEmpty || null;

        this.items = [];
        this.focusIndex = 0;
        this.windowStart = 0;
        this.active = false; // whether this list currently owns remote focus

        this.rows = [];
        for (var i = 0; i < this.visibleCount; i++) {
            var row = document.createElement('div');
            row.className = 'list-row';
            row.style.height = this.itemHeight + 'px';
            this.el.appendChild(row);
            this.rows.push(row);
        }
    }

    List.prototype.setItems = function (items, keepFocus) {
        this.items = items || [];
        if (!keepFocus) {
            this.focusIndex = 0;
            this.windowStart = 0;
        } else {
            this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.items.length - 1));
        }
        this._clampWindow();
        this._render();
        if (this.items.length === 0 && this.onEmpty) this.onEmpty();
    };

    List.prototype.setActive = function (active) {
        this.active = active;
        this.el.classList.toggle('list-active', active);
        this._render();
    };

    // Re-renders the currently visible rows without changing focus/scroll -
    // useful when row content (e.g. a favorite star) changed out from under it.
    List.prototype.refresh = function () {
        this._render();
    };

    List.prototype.getFocused = function () {
        return this.items[this.focusIndex];
    };

    List.prototype.getFocusedIndex = function () {
        return this.focusIndex;
    };

    List.prototype.setFocusIndex = function (idx) {
        if (idx < 0 || idx >= this.items.length) return;
        this.focusIndex = idx;
        this._clampWindow();
        this._render();
    };

    List.prototype.moveUp = function () {
        if (this.focusIndex <= 0) return false;
        this.focusIndex--;
        this._clampWindow();
        this._render();
        return true;
    };

    List.prototype.moveDown = function () {
        if (this.focusIndex >= this.items.length - 1) return false;
        this.focusIndex++;
        this._clampWindow();
        this._render();
        return true;
    };

    List.prototype._clampWindow = function () {
        var maxStart = Math.max(0, this.items.length - this.visibleCount);
        if (this.focusIndex < this.windowStart) {
            this.windowStart = this.focusIndex;
        } else if (this.focusIndex >= this.windowStart + this.visibleCount) {
            this.windowStart = this.focusIndex - this.visibleCount + 1;
        }
        if (this.windowStart > maxStart) this.windowStart = maxStart;
        if (this.windowStart < 0) this.windowStart = 0;
    };

    List.prototype._render = function () {
        for (var i = 0; i < this.visibleCount; i++) {
            var index = this.windowStart + i;
            var row = this.rows[i];
            var item = this.items[index];
            if (!item) {
                row.style.display = 'none';
                row.className = 'list-row';
                continue;
            }
            row.style.display = '';
            var isFocused = this.active && index === this.focusIndex;
            row.className = 'list-row' + (isFocused ? ' focused' : '');
            this.renderRow(item, row, index, isFocused);
        }
    };

    window.List = List;
})();
