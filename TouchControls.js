// Strange Flesh © 2017 by Greatest Bear Studios
//
// Strange Flesh is licensed under a
// Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.
//
// You should have received a copy of the license along with this
// work. If not, see <http://creativecommons.org/licenses/by-nc-sa/4.0/>.
//
// This sourcecode has not been minified or obfuscated in any way. Enjoy.
//
// ---------------------------------------------------------------------------
// On-screen touch controls for phones and tablets: a D-pad on the left and the
// action buttons on the right, drawn as HTML elements over the game canvas. They
// press the same buttons on the global PlayerInputController that the keyboard
// and gamepad do, so gameplay and menus need no touch-specific code.
//
// Every touch event recomputes the full set of held buttons from all active
// touches, so a thumb can slide across the D-pad or roll between action buttons.
//
// settings.touchControls: 0 = Auto (shown after the screen is touched, hidden
// again by keyboard or gamepad input), 1 = Always on, 2 = Off.

// D-pad: fraction of the pad radius that counts as centered, and the slope that
// splits each quadrant into a pure direction and a diagonal (tan 22.5°).
var touchDpadDeadZone = 0.25;
var touchDpadDiagonalSlope = 0.414;

// Action buttons, laid out and coloured like the default gamepad binding: Attack on
// A (bottom), Smoke on B (right), Grab on X (left), Jump on Y (top). The face buttons
// show their letter; Special and Poppers, on the shoulders, show an icon. "action"
// is each button's accessible name.
var touchActionButtons = [
	{ "name":"punch",   "glyph":"A",   "action":"Attack",  "className":"touchFace touchA", "right":"calc(var(--touchFace) * 1.05)", "bottom":"0" },
	{ "name":"smoke",   "glyph":"B",   "action":"Smoke",   "className":"touchFace touchB", "right":"0",                            "bottom":"calc(var(--touchFace) * 1.0)" },
	{ "name":"grab",    "glyph":"X",   "action":"Grab",    "className":"touchFace touchX", "right":"calc(var(--touchFace) * 2.1)", "bottom":"calc(var(--touchFace) * 1.0)" },
	{ "name":"jump",    "glyph":"Y",   "action":"Jump",    "className":"touchFace touchY", "right":"calc(var(--touchFace) * 1.05)", "bottom":"calc(var(--touchFace) * 2.0)" },
	{ "name":"special", "icon":"star", "action":"Special", "className":"touchShoulder",    "right":"calc(var(--touchFace) * 1.9)", "bottom":"calc(var(--touchFace) * 3.15)" },
	{ "name":"poppers", "icon":"bolt", "action":"Poppers", "className":"touchShoulder",    "right":"calc(var(--touchFace) * 0.2)", "bottom":"calc(var(--touchFace) * 3.15)" }
];

// Icons on a 24x24 grid, filled with the button's colour. Drawn rather than typed
// so they look the same on every phone (emoji and symbol fonts vary).
var touchIcons = {
	"star":
		'<path d="M12.0 1.5 L13.8 7.8 L19.4 4.6 L16.2 10.2 L22.5 12.0 L16.2 13.8 L19.4 19.4 L13.8 16.2 L12.0 22.5 L10.2 16.2 L4.6 19.4 L7.8 13.8 L1.5 12.0 L7.8 10.2 L4.6 4.6 L10.2 7.8 Z"/>',
	"bolt":
		'<path d="M14 1.5 L4.5 13.5 H11 L9.5 22.5 L19.5 9.5 H13 Z"/>',
	"pause":
		'<rect x="6" y="4" width="4.5" height="16" rx="1"/><rect x="13.5" y="4" width="4.5" height="16" rx="1"/>'
};

function touchIconSvg(name)
{
	return '<svg viewBox="0 0 24 24" aria-hidden="true">' + touchIcons[name] + '</svg>';
}

function TouchControls()
{
	var tc = this;

	// Buttons currently held by touch, keyed by controller button name
	this.held = {};
	this.lastInputWasTouch = false;
	this.dimmed = false;

	this.root = document.createElement("div");
	this.root.id = "touchControls";

	this.dpad = document.createElement("div");
	this.dpad.className = "touchDpad";
	this.dpadKnob = document.createElement("div");
	this.dpadKnob.className = "touchDpadKnob";
	this.dpad.appendChild(this.dpadKnob);
	this.root.appendChild(this.dpad);

	this.buttons = [];

	var actions = document.createElement("div");
	actions.className = "touchActions";
	for (var i = 0; i < touchActionButtons.length; i++)
	{
		var def = touchActionButtons[i];
		var el = document.createElement("div");
		el.className = "touchButton " + def.className;
		if (def.icon)
			el.innerHTML = touchIconSvg(def.icon);
		else
			el.textContent = def.glyph;
		el.setAttribute("aria-label", def.action);
		el.style.right = def.right;
		el.style.bottom = def.bottom;
		actions.appendChild(el);
		this.buttons.push({ "name":def.name, "element":el });
	}
	this.root.appendChild(actions);

	var start = document.createElement("div");
	start.className = "touchButton touchStart";
	start.innerHTML = touchIconSvg("pause");
	start.setAttribute("aria-label", "Pause");
	this.root.appendChild(start);
	this.buttons.push({ "name":"start", "element":start });

	document.body.appendChild(this.root);

	// Only touches that begin on a control are delivered here; touches elsewhere
	// fall through to the canvas (which is what unlocks iOS audio).
	var onTouch = function(evt) { tc.onTouch(evt); };
	this.root.addEventListener("touchstart", onTouch, { passive: false });
	this.root.addEventListener("touchmove", onTouch, { passive: false });
	this.root.addEventListener("touchend", onTouch, { passive: false });
	this.root.addEventListener("touchcancel", onTouch, { passive: false });

	// Auto mode follows whichever input was used last
	document.addEventListener("touchstart", function() { tc.setLastInputWasTouch(true); }, { passive: true });
	document.addEventListener("keydown", function() { tc.setLastInputWasTouch(false); }, false);
	window.addEventListener("gamepadconnected", function() { tc.setLastInputWasTouch(false); }, false);

	// Don't leave buttons stuck down if the page loses focus mid-press
	window.addEventListener("blur", function() { tc.releaseAll(); }, false);
	document.addEventListener("visibilitychange", function() { tc.releaseAll(); }, false);

	this.UpdateVisibility();
};

TouchControls.prototype.setLastInputWasTouch = function(wasTouch)
{
	if (this.lastInputWasTouch === wasTouch)
		return;
	this.lastInputWasTouch = wasTouch;
	this.UpdateVisibility();
};

TouchControls.prototype.IsVisible = function()
{
	if (settings.touchControls === 1)
		return true;
	if (settings.touchControls === 2)
		return false;
	return this.lastInputWasTouch;
};

TouchControls.prototype.UpdateVisibility = function()
{
	var visible = this.IsVisible();
	this.root.style.display = visible ? "block" : "none";
	if (!visible)
		this.releaseAll();
};

// Called every tick: fade the controls while a menu or cutscene is up so the menu
// text (which sits on the right, under the action buttons) stays readable.
TouchControls.prototype.Update = function()
{
	var dimmed = menuStack.length > 0;
	if (dimmed !== this.dimmed)
	{
		this.dimmed = dimmed;
		this.root.classList.toggle("dimmed", dimmed);
	}
};

TouchControls.prototype.onTouch = function(evt)
{
	// Keep the browser from scrolling, zooming, or synthesizing mouse clicks
	evt.preventDefault();

	var wanted = {};
	var knobTouch = null;

	for (var i = 0; i < evt.touches.length; i++)
	{
		var touch = evt.touches[i];

		// A touch that started on the D-pad steers it wherever the finger goes
		if (this.dpad.contains(touch.target))
		{
			this.dpadDirections(touch, wanted);
			knobTouch = touch;
		}
		else if (this.root.contains(touch.target))
		{
			var name = this.buttonAt(touch.clientX, touch.clientY);
			if (name !== null)
				wanted[name] = true;
		}
	}

	this.setHeld(wanted);
	this.positionKnob(knobTouch);
};

TouchControls.prototype.dpadDirections = function(touch, wanted)
{
	var rect = this.dpad.getBoundingClientRect();
	var radius = rect.width / 2;
	var dx = (touch.clientX - (rect.left + radius)) / radius;
	var dy = (touch.clientY - (rect.top + radius)) / radius;

	if (Math.abs(dx) > touchDpadDeadZone && Math.abs(dx) >= Math.abs(dy) * touchDpadDiagonalSlope)
		wanted[dx < 0 ? "left" : "right"] = true;
	if (Math.abs(dy) > touchDpadDeadZone && Math.abs(dy) >= Math.abs(dx) * touchDpadDiagonalSlope)
		wanted[dy < 0 ? "up" : "down"] = true;
};

TouchControls.prototype.buttonAt = function(x, y)
{
	for (var i = 0; i < this.buttons.length; i++)
	{
		var rect = this.buttons[i].element.getBoundingClientRect();
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
			return this.buttons[i].name;
	}
	return null;
};

TouchControls.prototype.positionKnob = function(touch)
{
	if (touch === null)
	{
		this.dpadKnob.style.transform = "";
		return;
	}

	// Follow the finger, clamped to the edge of the pad
	var rect = this.dpad.getBoundingClientRect();
	var radius = rect.width / 2;
	var dx = touch.clientX - (rect.left + radius);
	var dy = touch.clientY - (rect.top + radius);
	var dist = Math.sqrt(dx*dx + dy*dy);
	var maxDist = radius * 0.6;
	if (dist > maxDist)
	{
		dx = dx * maxDist / dist;
		dy = dy * maxDist / dist;
	}
	this.dpadKnob.style.transform = "translate(" + Math.round(dx) + "px, " + Math.round(dy) + "px)";
};

// Press newly wanted buttons and release the ones no longer touched
TouchControls.prototype.setHeld = function(wanted)
{
	var name;
	var anyPressed = false;

	for (name in this.held)
	{
		if (this.held.hasOwnProperty(name) && !wanted[name])
			controller[name + "KeyUp"]();
	}
	for (name in wanted)
	{
		if (wanted.hasOwnProperty(name) && !this.held[name])
		{
			controller[name + "KeyDown"]();
			anyPressed = true;
		}
	}

	if (anyPressed)
		controller.anyKeyDown();
	else if (Object.keys(wanted).length === 0 && Object.keys(this.held).length > 0)
		controller.anyKeyUp();

	this.held = wanted;

	for (var i = 0; i < this.buttons.length; i++)
		this.buttons[i].element.classList.toggle("pressed", !!wanted[this.buttons[i].name]);
};

TouchControls.prototype.releaseAll = function()
{
	this.setHeld({});
	this.positionKnob(null);
};
