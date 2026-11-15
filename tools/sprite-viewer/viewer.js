// Strange Flesh sprite viewer.
//
// A third entry point beside StrangeFlesh.js (the game) and StrangeEdit.js (the
// level editor). It loads the same engine files, builds real entities, and plays
// their animation states through the game's own AnimationModel and Sprite code,
// so what is on screen here is what the game would draw.
//
// It is a tool for checking art: play a state, step through it, see where the
// centre point, the frame edges and the hit boxes are, and see the mirrored
// version. It can also play a sheet no entity uses yet.
//
// Plain ES5, like the game. See docs/sprites.md.

// Globals the engine files expect to find (the same set StrangeEdit.js defines).
var debug = 0;
var enableRetina = true;
var enableSmoothing = false;
var playernoclip = false;
var isEditor = true;
var pause = false;
var nextObjectID = 0;

var settings = {
					"renderMode": 0,
					"enableRetina" : false,
					"musicLevelGameplay" : 0.5,
					"baseSFXBoost" : 1.0,
					"showDebugMenu" : true,
					"gameBeaten": false,
					"upKeyCode": 87,
					"downKeyCode": 83,
					"leftKeyCode": 65,
					"rightKeyCode": 68,
					"punchKeyCode": 74,
					"smokeKeyCode": 75,
					"grabKeyCode": 76,
					"jumpKeyCode": 32,
					"startKeyCode": 13
				};

var controller = null;
var fps = 60;
var pxScale = 3.0;
var c;
var ctx;
var camera;
var player = null;
var enemyinfo;
var debugoverlay;
var level = null;
var overlays = [];
var menuStack = [];
var gravity = 2.4;

function include(url)
{
	var head = document.getElementsByTagName('head')[0];
	var script = document.createElement('script');
	script.type = 'text/javascript';
	script.src = url;
	script.async = false;
	head.appendChild(script);
};

// The editor's list. Level.js pulls in every enemy and prop through JoeLevelAssets.js.
include("Font.js");
include("FileSaver.js");
include("ResourceLoader.js");
include("RandomSoundCollection.js");
include("DrawingUtility.js");
include("MathUtility.js");
include("StackBlur.js");
include("GlobalLight.js");
include("CollisionShapes.js");
include("SkirmishBox.js");
include("TransitionBox.js");
include("EntityList.js");
include("MatrixTransformation2D.js");
include("CanvasCamera.js");
include("Controller.js");
include("PlayerInputController.js");
include("Combat.js");
include("Animation.js");
include("EffectAnimation.js");
include("DualOwnerEffectAnimation.js");
include("RepeatingBackground.js");
include("SkewRectangle.js");
include("Rectangle.js");
include("LevelCollisionMask.js");
include("BlownSmoke.js");
include("HitSpark.js");
include("SmokeVolume.js");
include("SmokePuff.js");
include("SmokeKissPuff.js");
include("SmokeKissFallSmoke.js");
include("EntityStates.js");
include("AICore.js");
include("WalkingEntity.js");
include("CollectableOrb.js");
include("DroppedItem.js");
include("EntitySpawner.js");
include("Checkpoint.js");
include("Level.js");
include("Bartender.js");
include("Music.js");

function getVirtualScreenWidth()
{
	return 1080 * (c.width / c.height);
};

//////////////////////////////
// Viewer state
//////////////////////////////

var SHEET_PREFIX = "sheet: ";		// entity-menu entries that are sheets start with this
var NO_STATE = "\u0000none";		// a state name no entity has

var viewer = {
	ready: false,
	entity: null,			// the entity (or SheetEntity) on show
	entityName: "",
	stateName: "",
	fromState: "",			// state to pretend we came from, for transitions
	playing: true,
	speed: 1,
	tickDebt: 0,
	ticks: 0,				// updates since the state was entered
	doneTicks: 0,			// updates since a one-shot finished
	loopOneShots: true,
	moveSpeed: 8,
	view: "both",
	zoom: 0,				// 0 = fit
	backdrop: "#5c4458",
	showCenter: true,
	showFrame: true,
	showHit: true,
	showAutoAttacks: true,
	attacks: [],			// [{name, attack, checked}]
	ghost: null,			// entity drawn faintly behind
	ghostName: "",
	ghostState: "",
	sheets: {},				// label -> SheetEntity
	sheetFps: 10,
	stripKey: "",
	stripCells: [],
	infoText: "",
	error: ""
};

// Stands in for an entity when a sheet is played on its own. It has the few
// fields AnimationModel reads off its owner.
function SheetEntity(label, frames)
{
	this.displayName = label;
	this.isSheet = true;
	this.frames = frames;		// frame info objects, straight from the sheet's JSON
	this.facing = 1;
	this.posZ = 0;
	this.alpha = 1.0;
	this.effectOffsetX = 0;
	this.effectOffsetY = 0;
	this.animationModel = new AnimationModel(this);
};

SheetEntity.prototype.Speed = function()
{
	return viewer.moveSpeed;
};

function byId(id)
{
	return document.getElementById(id);
};

function queryParam(name)
{
	var match = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
	return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, " "));
};

//////////////////////////////
// Startup
//////////////////////////////

function SpriteViewer()
{
	c = byId("gameCanvas");
	ctx = c.getContext("2d");

	// The loader waits for a click before it calls itself ready, because the game
	// needs one to start audio. The viewer plays no sound.
	GlobalResourceLoader.webAudioLocked = false;
	GlobalResourceLoader.LoadAll();

	camera = new CanvasCamera();
	controller = new PlayerInputController();
	controller.usePermBindings = false;

	player = new Bartender();
	player.ChangeAlliance(1);
	player.controller = controller;
	level = new Level();

	GlobalResourceLoader.GameReady();

	wireControls();
	setInterval(tick, (1 / fps) * 1000);
};

function onResourcesReady()
{
	viewer.ready = true;
	byId("loading").style.display = "none";

	fillSelect(byId("entitySelect"), findEntityTypes(), null);
	fillSelect(byId("ghostEntitySelect"), [""].concat(findEntityTypes()), {"": "(nothing)"});
	refreshSheetSelect();

	if (queryParam("view") !== null) { viewer.view = queryParam("view"); byId("viewSelect").value = viewer.view; }
	if (queryParam("zoom") !== null) { viewer.zoom = parseInt(queryParam("zoom"), 10) || 0; byId("zoomSelect").value = String(viewer.zoom); }
	if (queryParam("paused") !== null) setPlaying(false);

	var afterLoad = function()
	{
		if (queryParam("state") !== null)
			selectState(queryParam("state"));
		if (queryParam("frame") !== null)
			jumpToFrame(parseInt(queryParam("frame"), 10) || 0);
	};

	if (queryParam("sheet") !== null)
		loadSheetFromPath(queryParam("sheet"), afterLoad);
	else
	{
		selectEntity(queryParam("entity") !== null ? queryParam("entity") : "Bartender");
		afterLoad();
	}
};

// Every constructor in the page that sets up animations is something to look at.
function findEntityTypes()
{
	var names = [];
	for (var key in window)
	{
		var value = null;
		try { value = window[key]; } catch (e) { continue; }
		if (typeof value === "function" && value.prototype && typeof value.prototype.animationSetup === "function")
			names.push(key);
	}
	names.sort();
	return names;
};

function fillSelect(select, values, labels)
{
	while (select.firstChild)
		select.removeChild(select.firstChild);
	for (var i = 0; i < values.length; i++)
	{
		var option = document.createElement("option");
		option.value = values[i];
		option.appendChild(document.createTextNode(labels !== null && labels.hasOwnProperty(values[i]) ? labels[values[i]] : values[i]));
		select.appendChild(option);
	}
};

//////////////////////////////
// Choosing what to show
//////////////////////////////

function buildEntity(typeName)
{
	var Constructor = window[typeName];
	if (typeof Constructor !== "function")
		throw new Error("There is no entity called " + typeName);
	var entity = new Constructor();

	// A few things (doors, thunderbolts) draw their animations themselves and
	// have no model. Give them one, so their animations can be played here.
	if (!entity.animationModel)
	{
		if (typeof entity.facing === "undefined") entity.facing = 1;
		if (typeof entity.posZ === "undefined") entity.posZ = 0;
		if (typeof entity.alpha === "undefined") entity.alpha = 1.0;
		if (typeof entity.effectOffsetX === "undefined") entity.effectOffsetX = 0;
		if (typeof entity.effectOffsetY === "undefined") entity.effectOffsetY = 0;
		entity.animationModel = new AnimationModel(entity);
	}

	// Walk cycles take their speed from the owner. Nothing moves in here, so the
	// slider stands in for it.
	entity.Speed = function() { return viewer.moveSpeed; };

	// Animations an entity keeps outside its model (effects it spawns, items it
	// drops) are worth seeing too. Wrap each in a state of its own.
	for (var key in entity)
	{
		if (!entity.hasOwnProperty(key))
			continue;
		var value = entity[key];
		if (value instanceof Animation)
			addLooseAnimation(entity, key, value);
		else if (value instanceof Array)
		{
			for (var i = 0; i < value.length; i++)
			{
				if (value[i] instanceof Animation)
					addLooseAnimation(entity, key + "[" + i + "]", value[i]);
			}
		}
	}
	if (stateNames(entity).length === 0)
		throw new Error(typeName + " has no animations to play");
	return entity;
};

function addLooseAnimation(entity, label, animation)
{
	if (animation.frames.length === 0)
		return;
	var state = new AnimationState();
	state.SetMainAnimation(animation);
	entity.animationModel.AddState("· " + label, state);
};

function stateNames(entity)
{
	var names = [];
	for (var name in entity.animationModel.animations)
	{
		if (entity.animationModel.animations.hasOwnProperty(name))
			names.push(name);
	}
	names.sort();
	return names;
};

function selectEntity(name)
{
	viewer.error = "";
	var entity = null;
	try
	{
		if (name.indexOf(SHEET_PREFIX) === 0)
			entity = viewer.sheets[name];
		else
			entity = buildEntity(name);
	}
	catch (e)
	{
		viewer.error = String(e.message || e);
	}
	if (!entity)
	{
		if (viewer.error === "")
			viewer.error = "Could not show " + name;
		return;
	}

	viewer.entity = entity;
	viewer.entityName = name;
	viewer.fromState = "";

	var entitySelect = byId("entitySelect");
	if (name.indexOf(SHEET_PREFIX) === 0 && !hasOption(entitySelect, name))
	{
		var option = document.createElement("option");
		option.value = name;
		option.appendChild(document.createTextNode(name));
		entitySelect.insertBefore(option, entitySelect.firstChild);
	}
	entitySelect.value = name;
	byId("sheetControls").style.display = entity.isSheet ? "block" : "none";

	// Attacks the entity owns, for the hit box overlay.
	viewer.attacks = [];
	if (!entity.isSheet)
	{
		for (var key in entity)
		{
			if (entity.hasOwnProperty(key) && entity[key] instanceof Attack)
				viewer.attacks.push({name: key, attack: entity[key], checked: false});
		}
		viewer.attacks.sort(function(a, b) { return a.name < b.name ? -1 : 1; });
	}
	buildAttackList();

	var names = stateNames(entity);
	fillSelect(byId("stateSelect"), names, null);
	var first = names.indexOf("idle") !== -1 ? "idle" : names[0];
	selectState(first);
};

function hasOption(select, value)
{
	for (var i = 0; i < select.options.length; i++)
	{
		if (select.options[i].value === value)
			return true;
	}
	return false;
};

function selectState(name)
{
	if (viewer.entity === null || !viewer.entity.animationModel.animations.hasOwnProperty(name))
		return;
	viewer.stateName = name;
	viewer.fromState = "";
	byId("stateSelect").value = name;

	// Offer the states this one has a transition from.
	var froms = [""];
	var transitions = viewer.entity.animationModel.animations[name].transitions;
	for (var key in transitions)
	{
		if (transitions.hasOwnProperty(key))
			froms.push(key);
	}
	fillSelect(byId("fromSelect"), froms, {"": froms.length > 1 ? "(no transition)" : "(this state has none)"});
	byId("fromSelect").disabled = froms.length < 2;

	enterState();
};

// Start the current state from the top, the way the game does when gameplay
// calls animationModel.ChangeState().
function enterState()
{
	var model = viewer.entity.animationModel;
	if (viewer.fromState !== "" && model.animations.hasOwnProperty(viewer.fromState))
	{
		model.animations[viewer.fromState].mainAnimation.position = 0;
		model.state = viewer.fromState;
	}
	else
	{
		model.state = NO_STATE;
	}
	model.ChangeState(viewer.stateName);
	viewer.ticks = 0;
	viewer.doneTicks = 0;
	refreshFlags();
};

function currentState()
{
	return viewer.entity.animationModel.animations[viewer.stateName];
};

// The game refreshes "which frame is showing" only when it draws (GetFrame).
// Do the same after every update, so the flags gameplay reads are right here too.
function refreshFlags()
{
	currentState().GetFrame();
};

function advance(count)
{
	var model = viewer.entity.animationModel;
	for (var i = 0; i < count; i++)
	{
		model.Update();
		viewer.ticks += 1;
		refreshFlags();
	}
};

function shownFrameIndex()
{
	var state = currentState();
	if (state.activeTransition !== null)
		return -1;
	return state.mainAnimation.lastDisplayedFrameIndex;
};

// Play from the top until done() says stop. Returns false if it never did.
function replayUntil(done, limit)
{
	enterState();
	for (var i = 0; i < limit; i++)
	{
		if (done())
			return true;
		advance(1);
	}
	return done();
};

function jumpToFrame(index)
{
	var animation = currentState().mainAnimation;
	if (animation.frames.length === 0)
		return;
	index = ((index % animation.frames.length) + animation.frames.length) % animation.frames.length;
	var found = replayUntil(function() { return shownFrameIndex() === index; }, 20000);
	if (!found)
	{
		// A frame the animation never reaches by playing (speed 0, or past the
		// loop). Put it on screen anyway.
		enterState();
		currentState().activeTransition = null;
		animation.position = animation.frames[index].position;
		refreshFlags();
	}
	setPlaying(false);
};

function stepFrame(direction)
{
	if (viewer.entity === null)
		return;
	setPlaying(false);
	var count = currentState().mainAnimation.frames.length;
	var index = shownFrameIndex();
	if (direction > 0)
	{
		// Run forward until the picture changes.
		for (var i = 0; i < 2000; i++)
		{
			advance(1);
			if (shownFrameIndex() !== index)
				return;
		}
		jumpToFrame(index + 1);
	}
	else
	{
		jumpToFrame(index <= 0 ? count - 1 : index - 1);
	}
};

function stepTick(direction)
{
	if (viewer.entity === null)
		return;
	setPlaying(false);
	if (direction > 0)
		advance(1);
	else
	{
		var target = Math.max(0, viewer.ticks - 1);
		enterState();
		advance(target);
	}
};

function setPlaying(playing)
{
	viewer.playing = playing;
	byId("playButton").firstChild.nodeValue = playing ? "Pause" : "Play";
};

//////////////////////////////
// Sheets on their own
//////////////////////////////

function refreshSheetSelect()
{
	var paths = [""];
	for (var i = 0; i < GlobalResourceLoader.images.length; i++)
	{
		var resource = GlobalResourceLoader.images[i];
		if (resource.infoSrc !== null && resource.info !== null)
			paths.push(resource.infoSrc);
	}
	paths.sort();
	fillSelect(byId("sheetSelect"), paths, {"": "(pick a sheet the game loads)"});
};

function sheetMessage(text, isError)
{
	var element = byId("sheetMessage");
	element.className = isError ? "error" : "";
	element.firstChild ? element.firstChild.nodeValue = text : element.appendChild(document.createTextNode(text));
};

// Turn a sheet's frame list into something playable: one looping state per run
// of numbered frames (walk1, walk2, ... becomes "walk"), plus one of everything.
function showSheet(label, frames)
{
	var entity = new SheetEntity(label, frames);
	var runs = {};
	var order = [];
	for (var i = 0; i < frames.length; i++)
	{
		var match = /^(.*?)(\d+)$/.exec(frames[i].name);
		var stem = match === null ? frames[i].name : match[1];
		if (!runs.hasOwnProperty(stem))
		{
			runs[stem] = [];
			order.push(stem);
		}
		runs[stem].push({name: frames[i].name, number: match === null ? 0 : parseInt(match[2], 10)});
	}

	var addState = function(stateName, names)
	{
		var animation = new Animation(entity);
		animation.repeat = 1;
		animation.inheritFacing = 1;
		for (var n = 0; n < names.length; n++)
			animation.AddFrame(names[n]);
		animation.SetDurationByFramerate(viewer.sheetFps);
		var state = new AnimationState();
		state.SetMainAnimation(animation);
		entity.animationModel.AddState(stateName, state);
	};

	var all = [];
	for (var f = 0; f < frames.length; f++)
		all.push(frames[f].name);
	addState("(all " + frames.length + " frames)", all);

	for (var r = 0; r < order.length; r++)
	{
		var run = runs[order[r]];
		run.sort(function(a, b) { return a.number - b.number; });
		var names = [];
		for (var k = 0; k < run.length; k++)
			names.push(run[k].name);
		addState(order[r] + (run.length > 1 ? "  (" + run.length + ")" : ""), names);
	}

	var key = SHEET_PREFIX + label;
	viewer.sheets[key] = entity;
	selectEntity(key);
	if (order.length === 1)
		selectState(order[0] + (runs[order[0]].length > 1 ? "  (" + runs[order[0]].length + ")" : ""));
	refreshCenterValue();
};

// Give the game's sprite table the frames of a sheet, the way
// ImageResource.GenerateSprites does. Returns how many names were already taken.
function installSheet(image, info)
{
	var canvas = document.createElement("canvas");
	printImageToCanvas(image, canvas);
	var replaced = 0;
	for (var i = 0; i < info.frames.length; i++)
	{
		if (GlobalResourceLoader.IsSpriteLoaded(info.frames[i].name) && GlobalResourceLoader.GetSprite(info.frames[i].name).inited)
			replaced += 1;
		GlobalResourceLoader.GetSprite(info.frames[i].name).Init(canvas, info.frames[i]);
	}
	return replaced;
};

function checkSheetInfo(info, image)
{
	if (!info || !(info.frames instanceof Array) || info.frames.length === 0)
		return "The .txt has no frames list.";
	for (var i = 0; i < info.frames.length; i++)
	{
		var frame = info.frames[i];
		var keys = ["name", "width", "height", "originX", "originY", "centerX", "centerY"];
		for (var k = 0; k < keys.length; k++)
		{
			if (!frame.hasOwnProperty(keys[k]))
				return "Frame " + i + " has no " + keys[k] + ".";
		}
		if (frame.originX < 0 || frame.originY < 0 || frame.originX + frame.width > image.width || frame.originY + frame.height > image.height)
			return frame.name + " lies outside the " + image.width + "x" + image.height + " image.";
	}
	return null;
};

function finishSheetLoad(label, image, info, done)
{
	var problem = checkSheetInfo(info, image);
	if (problem !== null)
	{
		sheetMessage(problem, true);
		return;
	}
	var replaced = installSheet(image, info);
	showSheet(label, info.frames);
	sheetMessage(info.frames.length + " frames loaded." + (replaced > 0 ? " " + replaced + " replace frames of the same name, so entities now show the new art." : ""), false);
	if (done)
		done();
};

function loadSheetFromPath(path, done)
{
	if (path.substr(path.length - 4) === ".png")
		path = path.substr(0, path.length - 4) + ".txt";
	sheetMessage("Loading " + path + "...", false);

	var request = new XMLHttpRequest();
	request.open("GET", path);
	request.onreadystatechange = function()
	{
		if (request.readyState !== 4)
			return;
		if (request.status !== 200)
		{
			sheetMessage("Could not load " + path + " (HTTP " + request.status + ").", true);
			return;
		}
		var info = null;
		try { info = JSON.parse(request.responseText); }
		catch (e) { sheetMessage(path + " is not valid JSON.", true); return; }

		var image = new Image();
		image.onload = function() { finishSheetLoad(path, image, info, done); };
		image.onerror = function() { sheetMessage("Could not load " + path.substr(0, path.length - 4) + ".png.", true); };
		image.src = path.substr(0, path.length - 4) + ".png?" + Date.now();
	};
	request.send(null);
};

function loadSheetFromFiles(files)
{
	var png = null;
	var txt = null;
	for (var i = 0; i < files.length; i++)
	{
		if (/\.png$/i.test(files[i].name)) png = files[i];
		if (/\.txt$/i.test(files[i].name)) txt = files[i];
	}
	if (png === null || txt === null)
	{
		sheetMessage("Pick the sheet's .png and its .txt together.", true);
		return;
	}

	var textReader = new FileReader();
	textReader.onload = function()
	{
		var info = null;
		try { info = JSON.parse(textReader.result); }
		catch (e) { sheetMessage(txt.name + " is not valid JSON.", true); return; }

		var imageReader = new FileReader();
		imageReader.onload = function()
		{
			var image = new Image();
			image.onload = function() { finishSheetLoad(txt.name, image, info, null); };
			image.onerror = function() { sheetMessage(png.name + " is not an image the browser can read.", true); };
			image.src = imageReader.result;
		};
		imageReader.readAsDataURL(png);
	};
	textReader.readAsText(txt);
};

// Sheet-only: move the centre point of every frame in the sheet, to find the
// value to hand the packer.
function nudgeCenter(dx, dy)
{
	if (viewer.entity === null || !viewer.entity.isSheet)
		return;
	var frames = viewer.entity.frames;
	for (var i = 0; i < frames.length; i++)
	{
		frames[i].centerX += dx;
		frames[i].centerY += dy;
	}
	refreshCenterValue();
};

function refreshCenterValue()
{
	var text = "";
	if (viewer.entity !== null && viewer.entity.isSheet && viewer.entity.frames.length > 0)
		text = "--center " + viewer.entity.frames[0].centerX + "," + viewer.entity.frames[0].centerY;
	var element = byId("centerValue");
	element.firstChild ? element.firstChild.nodeValue = text : element.appendChild(document.createTextNode(text));
};

function setSheetFps(value)
{
	viewer.sheetFps = Math.max(1, Math.min(60, value || 10));
	if (viewer.entity === null || !viewer.entity.isSheet)
		return;
	var animations = viewer.entity.animationModel.animations;
	for (var name in animations)
	{
		if (animations.hasOwnProperty(name))
			animations[name].mainAnimation.SetDurationByFramerate(viewer.sheetFps);
	}
};

function selectGhost(name, stateName)
{
	viewer.ghost = null;
	viewer.ghostName = name;
	if (name === "")
	{
		fillSelect(byId("ghostStateSelect"), [], null);
		return;
	}
	try
	{
		viewer.ghost = buildEntity(name);
	}
	catch (e)
	{
		viewer.error = String(e.message || e);
		return;
	}
	var names = stateNames(viewer.ghost);
	fillSelect(byId("ghostStateSelect"), names, null);
	if (!stateName || names.indexOf(stateName) === -1)
		stateName = names.indexOf("idle") !== -1 ? "idle" : names[0];
	byId("ghostStateSelect").value = stateName;
	viewer.ghostState = stateName;
	viewer.ghost.animationModel.state = NO_STATE;
	viewer.ghost.animationModel.ChangeState(stateName);
};

//////////////////////////////
// Controls
//////////////////////////////

function buildAttackList()
{
	var list = byId("attackList");
	while (list.firstChild)
		list.removeChild(list.firstChild);
	for (var i = 0; i < viewer.attacks.length; i++)
		addAttackCheckbox(list, viewer.attacks[i]);
};

function addAttackCheckbox(list, entry)
{
	var label = document.createElement("label");
	var box = document.createElement("input");
	box.type = "checkbox";
	box.onclick = function() { entry.checked = box.checked; };
	label.appendChild(box);
	label.appendChild(document.createTextNode(" " + entry.name + "  " + entry.attack.warmupframes + "+" + entry.attack.attackFrames + "+" + entry.attack.cooldownframes));
	label.title = "warm-up + active + cool-down, in ticks. Plays state \"" + entry.attack.animationTriggered + "\".";
	list.appendChild(label);
};

function wireControls()
{
	byId("entitySelect").onchange = function() { selectEntity(this.value); };
	byId("stateSelect").onchange = function() { selectState(this.value); };
	byId("fromSelect").onchange = function() { viewer.fromState = this.value; enterState(); };

	byId("prefixApplyButton").onclick = function()
	{
		var prefix = byId("prefixInput").value.replace(/\s+/g, "");
		if (prefix !== "" && viewer.entity !== null)
			viewer.entity.animationModel.ApplyPrefix(prefix);
		viewer.stripKey = "";
	};
	byId("prefixClearButton").onclick = function()
	{
		if (viewer.entity === null)
			return;
		var prefixes = viewer.entity.animationModel.prefixes.slice();
		for (var i = 0; i < prefixes.length; i++)
			viewer.entity.animationModel.ClearPrefix(prefixes[i]);
		viewer.stripKey = "";
	};

	byId("moveSpeedInput").oninput = function()
	{
		viewer.moveSpeed = parseFloat(this.value);
		byId("moveSpeedValue").firstChild.nodeValue = this.value;
	};

	byId("sheetSelect").onchange = function()
	{
		if (this.value === "")
			return;
		for (var i = 0; i < GlobalResourceLoader.images.length; i++)
		{
			var resource = GlobalResourceLoader.images[i];
			if (resource.infoSrc === this.value)
			{
				showSheet(resource.infoSrc, resource.info.frames);
				sheetMessage(resource.info.frames.length + " frames.", false);
			}
		}
	};
	byId("sheetLoadButton").onclick = function()
	{
		var path = byId("sheetPathInput").value.replace(/^\s+|\s+$/g, "");
		if (path !== "")
			loadSheetFromPath(path, null);
	};
	byId("sheetPathInput").onkeydown = function(e)
	{
		if (e.keyCode === 13)
			byId("sheetLoadButton").onclick();
	};
	byId("sheetFileInput").onchange = function() { loadSheetFromFiles(this.files); };
	byId("sheetFpsInput").onchange = function() { setSheetFps(parseFloat(this.value)); };
	byId("centerLeftButton").onclick = function() { nudgeCenter(1, 0); };
	byId("centerRightButton").onclick = function() { nudgeCenter(-1, 0); };
	byId("centerUpButton").onclick = function() { nudgeCenter(0, 1); };
	byId("centerDownButton").onclick = function() { nudgeCenter(0, -1); };
	byId("ghostEntitySelect").onchange = function() { selectGhost(this.value, null); };
	byId("ghostStateSelect").onchange = function() { selectGhost(viewer.ghostName, this.value); };

	byId("viewSelect").onchange = function() { viewer.view = this.value; };
	byId("zoomSelect").onchange = function() { viewer.zoom = parseInt(this.value, 10); };
	byId("backdropSelect").onchange = function() { viewer.backdrop = this.value; };
	byId("showCenterCheckbox").onclick = function() { viewer.showCenter = this.checked; };
	byId("showFrameCheckbox").onclick = function() { viewer.showFrame = this.checked; };
	byId("showHitCheckbox").onclick = function() { viewer.showHit = this.checked; };
	byId("showAutoAttacksCheckbox").onclick = function() { viewer.showAutoAttacks = this.checked; };

	byId("playButton").onclick = function() { setPlaying(!viewer.playing); };
	byId("restartButton").onclick = function() { if (viewer.entity !== null) enterState(); };
	byId("frameBackButton").onclick = function() { stepFrame(-1); };
	byId("frameForwardButton").onclick = function() { stepFrame(1); };
	byId("tickBackButton").onclick = function() { stepTick(-1); };
	byId("tickForwardButton").onclick = function() { stepTick(1); };
	byId("speedSelect").onchange = function() { viewer.speed = parseFloat(this.value); };
	byId("loopCheckbox").onclick = function() { viewer.loopOneShots = this.checked; };

	byId("stripCanvas").onclick = function(e)
	{
		var x = e.clientX - this.getBoundingClientRect().left;
		for (var i = 0; i < viewer.stripCells.length; i++)
		{
			if (x >= viewer.stripCells[i].x && x < viewer.stripCells[i].x + viewer.stripCells[i].width)
			{
				jumpToFrame(i);
				return;
			}
		}
	};

	document.addEventListener("keydown", function(e)
	{
		var tag = e.target && e.target.tagName;
		if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA")
			return;
		var handled = true;
		if (e.keyCode === 32) setPlaying(!viewer.playing);
		else if (e.keyCode === 82) { if (viewer.entity !== null) enterState(); }
		else if (e.keyCode === 37 && e.shiftKey) nudgeCenter(1, 0);
		else if (e.keyCode === 39 && e.shiftKey) nudgeCenter(-1, 0);
		else if (e.keyCode === 38 && e.shiftKey) nudgeCenter(0, 1);
		else if (e.keyCode === 40 && e.shiftKey) nudgeCenter(0, -1);
		else if (e.keyCode === 37) stepFrame(-1);
		else if (e.keyCode === 39) stepFrame(1);
		else if (e.keyCode === 188) stepTick(-1);
		else if (e.keyCode === 190) stepTick(1);
		else handled = false;
		if (handled)
			e.preventDefault();
	}, false);
};

//////////////////////////////
// The loop
//////////////////////////////

function tick()
{
	if (!viewer.ready)
	{
		if (GlobalResourceLoader.loadingError)
			byId("loading").firstChild.nodeValue = "Some art failed to load: " + GlobalResourceLoader.errorMessages.join("; ");
		else if (GlobalResourceLoader.AllReady())
			onResourcesReady();
		else
			byId("loading").firstChild.nodeValue = "Loading the game's art... " + GlobalResourceLoader.GetLoadPercentage() + "%";
		return;
	}
	updateAll();
	drawAll();
};

function updateAll()
{
	if (viewer.entity === null || !viewer.playing)
		return;

	viewer.tickDebt += viewer.speed;
	while (viewer.tickDebt >= 1)
	{
		viewer.tickDebt -= 1;
		advance(1);

		// A finished one-shot holds its last frame for half a second, then replays.
		var state = currentState();
		if (state.activeTransition === null && state.mainAnimation.repeat === 0 && state.mainAnimation.done)
		{
			viewer.doneTicks += 1;
			if (viewer.loopOneShots && viewer.doneTicks > 30)
				enterState();
		}
	}
};

function resizeCanvas()
{
	var stage = byId("stage");
	var ratio = enableRetina ? (window.devicePixelRatio || 1) : 1;
	var width = Math.max(64, Math.round(stage.clientWidth * ratio));
	var height = Math.max(64, Math.round(stage.clientHeight * ratio));
	if (c.width !== width || c.height !== height)
	{
		c.width = width;
		c.height = height;
		camera.canvasResized();
	}
	return ratio;
};

// How many screen pixels one sprite pixel gets.
function pickZoom(panelWidth, panelHeight, ratio)
{
	if (viewer.zoom > 0)
		return viewer.zoom * ratio;

	var widest = 1;
	var tallest = 1;
	var frames = currentState().mainAnimation.frames;
	for (var i = 0; i < frames.length; i++)
	{
		if (frames[i].image !== null && frames[i].image.inited)
		{
			widest = Math.max(widest, frames[i].image.width);
			tallest = Math.max(tallest, frames[i].image.height);
		}
	}
	var fit = Math.floor(Math.min(panelWidth * 0.9 / widest, panelHeight * 0.8 / tallest));
	return Math.max(1, Math.min(8 * ratio, fit));
};

function drawAll()
{
	var ratio = resizeCanvas();

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1.0;
	ctx.globalCompositeOperation = "source-over";
	ctx.fillStyle = viewer.backdrop;
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.imageSmoothingEnabled = false;

	if (viewer.entity === null)
	{
		drawInfo();
		return;
	}

	var facings = viewer.view === "both" ? [1, -1] : (viewer.view === "left" ? [-1] : [1]);
	var panelWidth = c.width / facings.length;
	var zoom = pickZoom(panelWidth, c.height, ratio);
	var scale = zoom / 3.0;		// world units are thirds of a sprite pixel (DrawSprite3x)

	for (var i = 0; i < facings.length; i++)
	{
		var originX = Math.round(panelWidth * (i + 0.5));
		var originY = Math.round(c.height * 0.82);

		ctx.save();
		ctx.beginPath();
		ctx.rect(panelWidth * i, 0, panelWidth, c.height);
		ctx.clip();
		ctx.setTransform(scale, 0, 0, scale, originX, originY);
		drawPanel(facings[i], scale, panelWidth / scale);
		ctx.restore();

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.font = (12 * ratio) + "px Menlo, Consolas, monospace";
		ctx.textAlign = "center";
		ctx.fillStyle = "rgba(255,255,255,0.75)";
		ctx.fillText(facings[i] === 1 ? "facing right (as drawn)" : "facing left (mirrored)", originX, 18 * ratio);
		if (i > 0)
		{
			ctx.fillStyle = "rgba(0,0,0,0.35)";
			ctx.fillRect(Math.round(panelWidth * i), 0, 1, c.height);
		}
	}

	drawStrip();
	drawInfo();
};

function drawPanel(facing, scale, worldWidth)
{
	var entity = viewer.entity;
	var line = 1.5 / scale * (window.devicePixelRatio || 1);
	entity.facing = facing;

	if (viewer.showCenter)
	{
		// The ground the entity stands on: y = 0 is posY.
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = line;
		ctx.beginPath();
		ctx.moveTo(-worldWidth, 0);
		ctx.lineTo(worldWidth, 0);
		ctx.stroke();
	}

	if (viewer.ghost !== null)
	{
		viewer.ghost.facing = facing;
		viewer.ghost.alpha = 0.4;
		viewer.ghost.animationModel.Draw();
	}

	// The same call EntityDrawSprite makes.
	entity.animationModel.Draw();
	ctx.globalAlpha = 1.0;
	ctx.globalCompositeOperation = "source-over";

	var state = currentState();
	var animation = state.GetAnimation();

	if (viewer.showFrame)
	{
		ctx.lineWidth = line;
		ctx.setLineDash([6 * line, 4 * line]);
		ctx.strokeStyle = "#35d6ff";
		strokeSpriteEdges(animation.lastDisplayedFrame, animation.GetFlipped(), 0, 0);
		ctx.strokeStyle = "rgba(53,214,255,0.45)";
		for (var d = 0; d < state.decoratorAnimations.length; d++)
		{
			var decorator = state.decoratorAnimations[d];
			var offsetX = 0;
			var offsetY = 0;
			if (decorator.useDecoratorOffset && animation.lastDisplayedFrame)
			{
				offsetX = animation.lastDisplayedFrame.offsetX * facing * 3.0;
				offsetY = animation.lastDisplayedFrame.offsetY * 3.0;
			}
			strokeSpriteEdges(decorator.lastDisplayedFrame, decorator.GetFlipped(), offsetX, offsetY);
		}
		ctx.setLineDash([]);
	}

	if (viewer.showHit && !entity.isSheet)
		drawHitShapes(entity, line);

	if (!entity.isSheet)
	{
		for (var a = 0; a < viewer.attacks.length; a++)
		{
			var entry = viewer.attacks[a];
			if (entry.checked || (viewer.showAutoAttacks && attackBelongsToState(entry, viewer.stateName)))
				drawAttackBox(entry, facing, line);
		}
	}

	if (viewer.showCenter)
	{
		// The centre point: where the frame's centerX, centerY lands.
		ctx.lineWidth = line * 2.5;
		ctx.strokeStyle = "#000000";
		drawCrosshairs(0, 0, 9 * line);
		ctx.lineWidth = line;
		ctx.strokeStyle = "#ffe14a";
		drawCrosshairs(0, 0, 9 * line);
	}
};

function strokeSpriteEdges(frame, flipped, offsetX, offsetY)
{
	if (!frame || !frame.image || !frame.image.inited)
		return;
	var info = frame.image.info;
	var left = flipped ? -(info.width - info.centerX) * 3.0 : -info.centerX * 3.0;
	ctx.strokeRect(left + offsetX, -info.centerY * 3.0 + offsetY, info.width * 3.0, info.height * 3.0);
};

// The same shapes EntityDraw shows in the game's debug view.
function drawHitShapes(entity, line)
{
	ctx.lineWidth = line;
	if (entity.hitRect)
	{
		ctx.strokeStyle = "#FF0000";
		drawBoundingBox(entity.hitRect);
		if (typeof entity.zHeight === "number")
		{
			ctx.globalAlpha = 0.08;
			ctx.fillStyle = "#00FF00";
			ctx.fillRect(entity.hitRect.xMin, -entity.zHeight, entity.hitRect.width(), entity.zHeight);
			ctx.globalAlpha = 0.6;
			ctx.strokeStyle = "#00FF00";
			ctx.strokeRect(entity.hitRect.xMin, -entity.zHeight, entity.hitRect.width(), entity.zHeight);
			ctx.globalAlpha = 1.0;
		}
	}
	if (typeof entity.collisionRadius === "number")
	{
		ctx.strokeStyle = "#00FF00";
		drawCircle(0, 0, entity.collisionRadius);
	}
};

// Does this attack go with this animation state? An attack names its state in
// animationTriggered, but that field starts out as "lightpunch" on every attack
// and most never change it, so "lightpunch" only counts when the attack's own
// name agrees (lightPunchAttack).
function attackBelongsToState(entry, stateName)
{
	var plainName = entry.name.toLowerCase().replace(/attack$/, "");
	if (plainName === stateName.toLowerCase())
		return true;
	return entry.attack.animationTriggered === stateName && stateName !== "lightpunch";
};

// Blue while the attack warms up, red while it can hit, magenta while it cools
// down: the colours Attack.Draw uses, timed from the moment the state began.
function drawAttackBox(entry, facing, line)
{
	var attack = entry.attack;
	var phase = "#9a9a9a";
	if (viewer.ticks < attack.warmupframes)
		phase = "#3d6bff";
	else if (viewer.ticks < attack.warmupframes + attack.attackFrames)
		phase = "#FF0000";
	else if (viewer.ticks < attack.warmupframes + attack.attackFrames + attack.cooldownframes)
		phase = "#FF00FF";

	var box = attack.attackbox.CopyAndMoveTo(0, 0, facing);
	ctx.lineWidth = line * (phase === "#FF0000" ? 2.5 : 1);
	ctx.strokeStyle = phase;
	drawBoundingBox(box);
	ctx.globalAlpha = phase === "#FF0000" ? 0.35 : 0.15;
	ctx.fillStyle = "#FFFF00";
	ctx.fillRect(box.xMin, -attack.zHeight - attack.zSize, box.width(), attack.zSize * 2);
	ctx.globalAlpha = 1.0;
};

// Every frame of the state's main animation in a row, numbered the way
// GetLastFrameIndex() numbers them. Click one to jump to it.
function drawStrip()
{
	var canvas = byId("stripCanvas");
	var animation = currentState().mainAnimation;
	var shown = shownFrameIndex();
	var names = [];
	for (var n = 0; n < animation.frames.length; n++)
		names.push(animation.frames[n].name);
	var key = viewer.entityName + "|" + viewer.stateName + "|" + names.join(",") + "|" + shown;
	if (key === viewer.stripKey)
		return;
	viewer.stripKey = key;

	var cellHeight = 100;
	var pictureHeight = 78;
	var cells = [];
	var x = 0;
	for (var i = 0; i < animation.frames.length; i++)
	{
		var sprite = animation.frames[i].image;
		var width = 40;
		if (sprite !== null && sprite.inited)
			width = Math.max(28, Math.round(sprite.width * pictureHeight / sprite.height));
		cells.push({x: x, width: width + 6});
		x += width + 6;
	}
	viewer.stripCells = cells;

	canvas.width = Math.max(1, x);
	canvas.height = cellHeight;
	canvas.style.width = canvas.width + "px";
	var g = canvas.getContext("2d");
	g.imageSmoothingEnabled = false;
	g.font = "11px Menlo, Consolas, monospace";
	g.textAlign = "center";

	for (var f = 0; f < animation.frames.length; f++)
	{
		var cell = cells[f];
		g.fillStyle = f === shown ? "#6a5a2a" : (f % 2 === 0 ? "#34343a" : "#2b2b30");
		g.fillRect(cell.x, 0, cell.width, cellHeight);

		var image = animation.frames[f].image;
		if (image !== null && image.inited)
			g.drawImage(image.sourceImage, image.info.originX, image.info.originY, image.info.width, image.info.height, cell.x + 3, 2, cell.width - 6, pictureHeight);
		else
		{
			g.fillStyle = "#77777f";
			g.fillText(image === null ? "blank" : "?", cell.x + cell.width / 2, 44);
		}

		g.fillStyle = f === shown ? "#ffe14a" : "#b8b8c0";
		g.fillText(String(f), cell.x + cell.width / 2, 94);
	}
};

var REPEAT_NAMES = ["one-shot", "loop", "bounce", "complete loop (transition)"];
var FACING_NAMES = ["never mirrored", "mirrored when facing left", "mirrored when facing right", "always mirrored"];

function describeFrame(frame)
{
	if (!frame)
		return "(none)";
	if (frame.image === null || typeof frame.image === "undefined")
		return "(blank)";
	if (!frame.image.inited)
		return frame.name + "  NOT LOADED";
	var info = frame.image.info;
	return frame.name + "\n    " + info.width + "x" + info.height + " at " + info.originX + "," + info.originY + ", centre " + info.centerX + "," + info.centerY;
};

function drawInfo()
{
	var lines = [];
	if (viewer.error !== "")
		lines.push("ERROR: " + viewer.error, "");

	if (viewer.entity !== null)
	{
		var entity = viewer.entity;
		var state = currentState();
		var main = state.mainAnimation;
		var animation = state.GetAnimation();
		var seconds = 1.0 / (60.0 * main.baseRate);

		lines.push(viewer.entityName + " / " + viewer.stateName);
		if (state.activeTransition !== null)
			lines.push("playing the transition from \"" + state.activeTransition + "\"");
		lines.push("");
		lines.push("frame      " + (shownFrameIndex() === -1 ? "-" : shownFrameIndex()) + " of " + main.frames.length + "   (GetLastFrameIndex)");
		lines.push("new frame  " + (main.lastFrameWasTransition ? "yes" : "no") + "   (GetLastFrameWasTransition)");
		lines.push("tick       " + viewer.ticks);
		lines.push("position   " + animation.position.toFixed(4));
		lines.push("");
		lines.push("repeat     " + main.repeat + "  " + (REPEAT_NAMES[main.repeat] || "?"));
		if (main.dynamicRate === 1)
			lines.push("length     " + seconds.toFixed(2) + " s at speed 1; " + (viewer.moveSpeed > 0 ? (seconds / viewer.moveSpeed).toFixed(2) + " s at speed " + viewer.moveSpeed : "stopped at speed 0"));
		else
			lines.push("length     " + seconds.toFixed(2) + " s = " + Math.round(seconds * 60) + " ticks");
		if (main.loopStartPosition !== 0 || main.loopEndPosition !== 1)
			lines.push("loops      " + main.loopStartPosition.toFixed(3) + " to " + main.loopEndPosition.toFixed(3));
		lines.push("facing     " + main.inheritFacing + "  " + (FACING_NAMES[main.inheritFacing] || "?"));
		if (main.blendMode !== "source-over" || main.alpha !== 1)
			lines.push("blend      " + main.blendMode + ", alpha " + main.alpha);
		if (entity.animationModel.prefixes.length > 0)
			lines.push("variant    " + entity.animationModel.prefixes.join(", "));
		lines.push("");
		lines.push("base   " + describeFrame(animation.lastDisplayedFrame));
		for (var d = 0; d < state.decoratorAnimations.length; d++)
		{
			var decorator = state.decoratorAnimations[d];
			var offset = "";
			if (decorator.useDecoratorOffset && animation.lastDisplayedFrame && (animation.lastDisplayedFrame.offsetX || animation.lastDisplayedFrame.offsetY))
				offset = "\n    moved " + animation.lastDisplayedFrame.offsetX + "," + animation.lastDisplayedFrame.offsetY + " by the base frame";
			lines.push("layer " + d + "  " + describeFrame(decorator.lastDisplayedFrame) + offset);
		}

		if (!entity.isSheet)
		{
			lines.push("");
			if (entity.hitRect)
				lines.push("hit box    " + entity.hitRect.width() + " x " + entity.hitRect.height() + " on the ground (red)");
			if (typeof entity.zHeight === "number")
				lines.push("height     " + entity.zHeight + " = " + Math.round(entity.zHeight / 3) + " sprite px (green)");
			if (typeof entity.collisionRadius === "number")
				lines.push("collision  radius " + entity.collisionRadius + " (green circle)");
		}
	}

	var text = lines.join("\n");
	if (text !== viewer.infoText)
	{
		viewer.infoText = text;
		var info = byId("info");
		info.firstChild ? info.firstChild.nodeValue = text : info.appendChild(document.createTextNode(text));
	}

	var status = "";
	if (viewer.entity !== null)
		status = "frame " + (shownFrameIndex() === -1 ? "-" : shownFrameIndex()) + "/" + currentState().mainAnimation.frames.length + "  tick " + viewer.ticks;
	var statusElement = byId("transportStatus");
	statusElement.firstChild ? statusElement.firstChild.nodeValue = status : statusElement.appendChild(document.createTextNode(status));
};
