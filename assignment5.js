"use strict";

var canvas;
var gl;
var vBuffer;
var nBuffer;
var iBuffer;
var tBuffer;
var vBufferIdx;                     // current index of vertex buffer
var nBufferIdx;                     // current index of normal buffer
var iBufferIdx;                     // current index of element buffer
var tBufferIdx;                     // current index of texture buffer

const NUM_VERTS = 100000;
const VERT_DATA_SIZE = 12;          // each vertex = (3 axes) * sizeof(float)
const NORMAL_DATA_SIZE = VERT_DATA_SIZE;
const TEXTURE_DATA_SIZE = 8;        // each vertex = (2 axes) * sizeof(float)

const NUM_ELEMS = 120000;  
const ELEM_DATA_SIZE = Uint16Array.BYTES_PER_ELEMENT;

var objs = [];
var meshes = [];
var currObj = null;

var mvMatrixLoc;
var prMatrixLoc;
var ambientPrLoc, diffusePrLoc, specularPrLoc;
var lightPosLoc;
var shininessLoc;
var samplerLoc;
var texEnableLoc;
var lightEnableLoc;

// camera
var camEye;
var camAt;
var up;
const EARTH_RADIUS = 6378;
const ZOOM_MIN = 12000.0;           // Nearer requires bigger textures
const ZOOM_MAX = 70000.0;

var mouse_btn = false;              // state of mouse button
var textureCnt = 0;

var checkboardIdx;
var earthIdx, cloudsIdx, bordersIdx, waterIdx;

//-------------------------------------------------------------------------------------------------
function Light() 
{
    // light properties
    this.ambient  = vec4(0.2, 0.2, 0.2, 1.0);
    this.diffuse  = vec4(1.0, 1.0, 1.0, 1.0);
    this.specular = vec4(1.0, 1.0, 1.0, 1.0);
    this.pos = vec4(1000.0, 0.0, 0.0, 1.0);
}

Light.prototype.transform = function(camera)
{
    // transform from instance -> world coordinates
    var t = translate(this.pos[0], this.pos[1], this.pos[2]);
    // combine with camera transformation to create model-view matrix
    var mv = mult(camera, t);
    var lightPosVec = mat_vec_mult(mv, vec4(0, 0, 0, 1));
    return lightPosVec;
}

var lights = [];

//-------------------------------------------------------------------------------------------------
function Mesh() 
{
    this.vertIdx = -1;
    this.normIdx = -1;
    this.elemIdx = -1;
    this.texIdx  = -1;
    this.triangleCnt = 0;
}

Mesh.prototype.addPoint = function(p)
{
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vBufferIdx * VERT_DATA_SIZE, flatten(p));
    if (this.vertIdx == -1) {
        // start of object
        this.vertIdx = vBufferIdx;
    }
    vBufferIdx++;
}

Mesh.prototype.addNormal = function(p)
{
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, nBufferIdx * NORMAL_DATA_SIZE, flatten(p));
    if (this.normIdx == -1) {
        // start of object
        this.normIdx = nBufferIdx;
    }
    nBufferIdx++;
}

Mesh.prototype.addTexPos = function(p)
{
    gl.bindBuffer(gl.ARRAY_BUFFER, tBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, tBufferIdx * TEXTURE_DATA_SIZE, flatten(p));
    if (this.texIdx == -1) {
        // start of object
        this.texIdx = tBufferIdx;
    }
    tBufferIdx++;
}

Mesh.prototype.addTriangle = function(p0, p1, p2)
{
    this.addPoint(p0);
    this.addPoint(p1);
    this.addPoint(p2);
    var N = normalize(cross(subtract(p2, p0), subtract(p1, p0)));
    this.addNormal(N);
    this.addNormal(N);
    this.addNormal(N);
    this.triangleCnt++;
}

Mesh.prototype.addTopology = function(t)
{
    // adjust topology indexes to point to vertices in vertex array
    // with offset this.vertIdx
    var adjTopo = [];
    for (var i = 0; i < t.length; ++i) {
        adjTopo.push(t[i] + this.vertIdx);
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iBufferIdx * ELEM_DATA_SIZE, new Uint16Array(adjTopo)); 
    if (this.elemIdx == -1) {
        // start of object
        this.elemIdx = iBufferIdx;
    }
    iBufferIdx += adjTopo.length;
}

//-------------------------------------------------------------------------------------------------
function CADObject(name, mesh)
{
    this.name = name;
    this.mesh = mesh;

    // degault lighting material properties
    this.ambient  = vec4(0.25, 0.25, 0.25, 1.0);
    this.diffuse  = vec4(1.0, 1.0, 1.0, 1.0);
    this.specular = vec4(0.2, 0.2, 0.2, 1.0);
    this.shininess = 15.0;

    // default orientation in world space
    this.rotate = [0, 0, 0];
    this.scale  = [1, 1, 1];
    this.translate = [0, 0, 0];
}

CADObject.prototype.transform = function(camera)
{
    // transform from instance -> world coordinates
    var s = scalem(this.scale);
    var rx = rotate(this.rotate[0], [1, 0, 0]);
    var ry = rotate(this.rotate[1], [0, 1, 0]);
    var rz = rotate(this.rotate[2], [0, 0, 1]);
    var t = translate(this.translate);
    var r = mult(rz, mult(ry, rx));
    var world = mult(t, mult(r, s));
    // combine with camera transformation to create model-view matrix
    var mv = mult(camera, world);
    gl.uniformMatrix4fv(mvMatrixLoc, gl.FALSE, flatten(mv));
}

//-------------------------------------------------------------------------------------------------
function Sphere(resolution) {
    Mesh.call(this);
    this.resolution = resolution || 48;
}
Sphere.prototype = Object.create(Mesh.prototype);

Sphere.prototype.addVertices = function() 
{
    function addTriangle(a, b, c)
    {
        var p0 = this.vert.length;
        this.vert.push(a);
        var p1 = p0 + 1; 
        this.vert.push(b);
        var p2 = p1 + 1; 
        this.vert.push(c);
        topo.push(p0);
        topo.push(p1);
        topo.push(p2);
        this.addPoint(this.vert[p0]);
        this.addPoint(this.vert[p1]);
        this.addPoint(this.vert[p2]);
        this.addNormal(this.vert[p0]);
        this.addNormal(this.vert[p1]);
        this.addNormal(this.vert[p2]);
    }
    function getTexCoords(theta, phi)
    {
        // map to [0,1]x[0,1] texture square
        var s = (theta / (2.0 * Math.PI));
        var t = 0.5 - (phi / Math.PI);
        return [s, t];
    }

    var CNT = this.resolution;
    this.vert = [];
    var topo = [];
    for (var lat = - (CNT / 2) + 1; lat < CNT / 2 - 1; ++lat) {
        var phi1 = lat / (CNT / 2) * (Math.PI / 2);
        var phi2 = (lat + 1) / (CNT / 2) * (Math.PI / 2);
        for (var lon  = 0; lon < CNT; ++lon) {
            var theta1 = (lon / CNT) * 2 * Math.PI;
            var theta2 = ((lon  + 1) / CNT) * 2 * Math.PI;
            // 4 points of quad
            var a = spherical_to_cartesian(theta1, phi1);
            var b = spherical_to_cartesian(theta2, phi1);
            var c = spherical_to_cartesian(theta1, phi2);
            var d = spherical_to_cartesian(theta2, phi2);
            // construct 2 triangles
            addTriangle.call(this, a, b, d);
            this.addTexPos(getTexCoords(theta1, phi1));
            this.addTexPos(getTexCoords(theta2, phi1));
            this.addTexPos(getTexCoords(theta2, phi2));
            addTriangle.call(this, a, d, c);
            this.addTexPos(getTexCoords(theta1, phi1));
            this.addTexPos(getTexCoords(theta2, phi2));
            this.addTexPos(getTexCoords(theta1, phi2));
        }
    }
    // add caps
    var south = [0, -1, 0];
    var north = [0,  1, 0];
    var phi_south = (-(CNT / 2) + 1) / (CNT / 2) * (Math.PI / 2);
    var phi_north = ((CNT / 2) - 1) / (CNT / 2) * (Math.PI / 2);
    for (var lon  = 0; lon < CNT; ++lon) {
        var theta1 = (lon / CNT) * 2 * Math.PI;
        var theta2 = ((lon  + 1) / CNT) * 2 * Math.PI;
        // 4 points of quad
        var s1 = spherical_to_cartesian(theta1, phi_south);
        var s2 = spherical_to_cartesian(theta2, phi_south);
        var n1 = spherical_to_cartesian(theta1, phi_north);
        var n2 = spherical_to_cartesian(theta2, phi_north);
        // construct 2 triangles
        addTriangle.call(this, south, s2, s1);
        this.addTexPos([(theta1 + theta2) / (4 * Math.PI), 1]);
        this.addTexPos(getTexCoords(theta2, phi_south));
        this.addTexPos(getTexCoords(theta1, phi_south));
        addTriangle.call(this, north, n1, n2);
        this.addTexPos([(theta1 + theta2) / (4 * Math.PI), 0]);
        this.addTexPos(getTexCoords(theta1, phi_north));
        this.addTexPos(getTexCoords(theta2, phi_north));
    }
 
    // send triangles to element buffer
    this.addTopology(topo);
    this.elemCnt = topo.length;
}

Sphere.prototype.draw = function() 
{
    gl.drawElements(gl.TRIANGLES, this.elemCnt, gl.UNSIGNED_SHORT, this.elemIdx * ELEM_DATA_SIZE);
}

//-------------------------------------------------------------------------------------------------
function spherical_to_cartesian(theta, phi)
{
    // phi is angle from xz-plane, need angle from y-axis
    var rho = Math.PI / 2 - phi;
    var x = Math.sin(rho) * Math.sin(theta);
    var y = Math.cos(rho);
    var z = Math.sin(rho) * Math.cos(theta);
    return [x, y, z];
}

//-------------------------------------------------------------------------------------------------
window.onload = function init()
{
    canvas = document.getElementById("gl-canvas");

    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { 
        alert("WebGL isn't available"); 
    }

    //  Configure WebGL
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);

    //  Load shaders and initialize attribute buffers
    var program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    // Load the data into the GPU
    
    // vertex buffer:
    vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, NUM_VERTS * VERT_DATA_SIZE, gl.STATIC_DRAW);
    vBufferIdx = 0;
    // Associate shader variables with our data buffer
    var vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 3, gl.FLOAT, false, 3 * 4, 0);
    gl.enableVertexAttribArray(vPosition);
    
    // normal buffer:
    nBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, NUM_VERTS * NORMAL_DATA_SIZE, gl.STATIC_DRAW);
    nBufferIdx = 0;
    // Associate shader variables with our data buffer
    var vNormal = gl.getAttribLocation(program, "vNormal");
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 3 * 4, 0);
    gl.enableVertexAttribArray(vNormal);
    
    // index buffer:
    iBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, NUM_ELEMS * ELEM_DATA_SIZE, gl.STATIC_DRAW); 
    iBufferIdx = 0;
    
    // texture buffer:
    tBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, NUM_VERTS * TEXTURE_DATA_SIZE, gl.STATIC_DRAW);
    tBufferIdx = 0;
    // Associate shader variables with our data buffer
    var vTexCoord = gl.getAttribLocation(program, "vTexCoord");
    gl.vertexAttribPointer(vTexCoord, 2, gl.FLOAT, false, 2 * 4, 0);
    gl.enableVertexAttribArray(vTexCoord);

    mvMatrixLoc    = gl.getUniformLocation(program, 'mvMatrix');
    prMatrixLoc    = gl.getUniformLocation(program, 'prMatrix');
    ambientPrLoc   = gl.getUniformLocation(program, 'ambientProduct');
    diffusePrLoc   = gl.getUniformLocation(program, 'diffuseProduct');
    specularPrLoc  = gl.getUniformLocation(program, 'specularProduct');
    lightPosLoc    = gl.getUniformLocation(program, 'lightPosition');
    shininessLoc   = gl.getUniformLocation(program, 'shininess');
    samplerLoc     = gl.getUniformLocation(program, 'sampler');
    texEnableLoc   = gl.getUniformLocation(program, 'texEnable');
    lightEnableLoc = gl.getUniformLocation(program, 'lightEnable');
    
    // Create meshes
    meshes['sphere'] = new Sphere();
    for (var key in meshes) {
        if (meshes.hasOwnProperty(key)) {
            meshes[key].addVertices();
        }
    }
    
    document.getElementById('btn-reset').onclick = reset_scene;
    
    // catch mouse down in canvas, catch other mouse events in whole window
    canvas.addEventListener('mousemove', mouse_move);
    canvas.onwheel = mouse_zoom;
   
    reset_scene();
    
    // lights
    var light = new Light();
    light.ambient  = vec4(0.2, 0.2, 0.2, 1.0);
    light.diffuse  = vec4(0.8, 0.8, 0.8, 1.0);
    light.specular = vec4(1.0, 1.0, 1.0, 1.0);
    light.pos = vec4(50e6, 0.0, 140e6, 1.0);
    lights.push(light);

    // default objects on canvas
    create_new_obj('sphere');
    currObj.scale = [EARTH_RADIUS, EARTH_RADIUS - 18, EARTH_RADIUS];
    currObj.translate = [0, 0, 0];
    currObj.rotate = [0, 0, 15];
    currObj.diffuse   = vec4(1.0, 1.0, 1.0, 1.0);
    currObj.specular  = vec4(0.2, 0.2, 0.2, 1.0);
    currObj.shininess = 20.0;
    
    // Textures
    checkboardIdx = configureTexture(gen_checkboard(), true);

    {
        var img1 = new Image();
        img1.src = "textures/no_clouds.jpg";
        img1.onload = function() {
            earthIdx = configureTexture(img1, false);
        }
        var img2 = new Image();
        img2.src = "textures/fair_clouds.jpg";
        img2.onload = function() {
            cloudsIdx = configureTexture(img2, false);
        }
        var img3 = new Image();
        img3.src = "textures/boundaries.png";
        img3.onload = function() {
            bordersIdx = configureTexture(img3, false);
        }
        var img4 = new Image();
        img4.src = "textures/cities.png";
        img4.onload = function() {
            waterIdx = configureTexture(img4, false);
        }
        
        //image.src = "textures/earth_8k.jpg";
        //image.src = "textures/2_no_clouds_8k.jpg";
        //image.src = "textures/boundaries_8k.png";
        //image.src = "textures/storm_clouds_8k.jpg";
        //image.src = "textures/5_night_8k.jpg";
    }
    
    render();
}

//-------------------------------------------------------------------------------------------------
function create_new_obj(objType)
{
    objs.push(new CADObject(name, meshes[objType]));
    currObj = objs[objs.length - 1];
}

//-------------------------------------------------------------------------------------------------
function reset_scene()
{
    camEye = [-20000, 2000, 30000];
    camAt  = [0, 0, 0];
    up = [0, 1, 0];
}

//-------------------------------------------------------------------------------------------------
function mat_vec_mult(mat, vec)
{
    var v = vec.slice();
    if (vec.length == 3) {
        v.push(1);
    }
    var res = [dot(mat[0], v),
               dot(mat[1], v),
               dot(mat[2], v),
               dot(mat[3], v)];

    if (vec.length == 3) {
        res.pop();
    }

    return res;
}

//-------------------------------------------------------------------------------------------------
function mouse_move(ev)
{
    if (typeof mouse_move.x == 'undefined') {
        mouse_move.x = ev.pageX;
        mouse_move.y = ev.pageY;
    }
    var dx = Math.sign(mouse_move.x - ev.pageX);
    var dy = Math.sign(ev.pageY - mouse_move.y);
    mouse_move.x = ev.pageX;
    mouse_move.y = ev.pageY;

    if (ev.buttons & 1) {
        // make rotation angle dependend on radius of camera
        var angle_scale = (length(camEye) - EARTH_RADIUS) / (ZOOM_MAX / 2);

        // calculate new up vector perpendicular to current view
        // and in same plane as old up
        var newup = normalize(vec3(camEye));
        newup = subtract(up, scale(dot(up, newup), newup));
        if (dx) {
            //rotate left/right: around newup
            camEye = mat_vec_mult(rotate(dx * angle_scale, newup), camEye);
        } 
        if (dy) {
            // rotate up/down: around vec normal to current view plane
            var dir = cross(camEye, up);
            camEye = mat_vec_mult(rotate(dy * angle_scale, dir), camEye);
            // change up to new up
            up = newup;
        }
    }
}

//-------------------------------------------------------------------------------------------------
function mouse_zoom(ev)
{
    var dir = Math.sign(ev.deltaY);

    var r = length(camEye);
    r += dir * 1000.0;
    if (r > ZOOM_MAX) {
        r = ZOOM_MAX;
    } else if (r < ZOOM_MIN) {
        r = ZOOM_MIN;
    }
    var unit = normalize(camEye);
    for (var i = 0; i < camEye.length; ++i) {
        camEye[i] = r * unit[i];
    }

    ev.preventDefault();
}

//-------------------------------------------------------------------------------------------------
function gen_checkboard()
{
    var texSize = 512;
    var numChecks = 32;

    var image = new Uint8Array(4 * texSize * texSize);
    for ( var i = 0; i < texSize; i++ ) {
        for ( var j = 0; j <texSize; j++ ) {
            var patchx = Math.floor(i / (texSize / numChecks));
            var patchy = Math.floor(j / (texSize / numChecks));
            var c;
            if ((patchx % 2) ^ (patchy % 2)) {
                c = 255;
            } else {
                c = 0;
            }
            image[4 * i * texSize + 4 * j]     = c;
            image[4 * i * texSize + 4 * j + 1] = c;
            image[4 * i * texSize + 4 * j + 2] = c; 
            image[4 * i * texSize + 4 * j + 3] = 255;
        }
    }
    return image;
}

//-------------------------------------------------------------------------------------------------
function configureTexture(image, synthetic) 
{
    gl.activeTexture(gl.TEXTURE0 + textureCnt);
    textureCnt++;
    
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    if (synthetic) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        // TODO: assume img is square
        var size = Math.sqrt(image.length / 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0,  gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.generateMipmap(gl.TEXTURE_2D);

    return textureCnt - 1;
}

var texEnable   = [true, false, false, false];
var textureUnit = [0, 0, 0, 0];

//-------------------------------------------------------------------------------------------------
function render()
{
    var cam = lookAt(camEye, camAt, up);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    var pr = perspective(22, 1.3333, 1, 1000000);
    //var pr = ortho(-8680, 8680, -6500, 6500, 0, 1000000);
    gl.uniformMatrix4fv(prMatrixLoc, gl.FALSE, flatten(pr));
    
    var cb_light = document.getElementById('cb-light');
    gl.uniform1i(lightEnableLoc, cb_light.checked);
    
    if (document.getElementById('cb-animate').checked) {
        objs[0].rotate[1] += 0.1;
    }

    if (document.getElementById('cb-checkerboard').checked) {
        texEnable[0] = true;
        texEnable[1] = false;
        texEnable[2] = false;
        texEnable[3] = false;
        textureUnit[0] = checkboardIdx;
    } else {
        texEnable[0] = true;
        texEnable[1] = document.getElementById('cb-clouds').checked;
        texEnable[2] = document.getElementById('cb-borders').checked;
        texEnable[3] = cb_light.checked;
        textureUnit[0] = earthIdx;
        textureUnit[1] = cloudsIdx;
        textureUnit[2] = bordersIdx;
        textureUnit[3] = waterIdx;
    }
    gl.uniform1iv(texEnableLoc, texEnable);
    gl.uniform1iv(samplerLoc, textureUnit);

    // iterate over all objects, do model-view transformation
    for (var i = 0; i < objs.length; ++i) {
        var ambientPr  = [];
        var diffusePr  = [];
        var specularPr = [];
        var lightPos   = [];
        for (var j = 0; j < lights.length; ++j) {
            var lightPosVec = lights[j].transform(cam);
            
            ambientPr = ambientPr.concat(mult(lights[j].ambient, objs[i].ambient));
            if (1) {
                diffusePr = diffusePr.concat(mult(lights[j].diffuse, objs[i].diffuse));
                specularPr = specularPr.concat(mult(lights[j].specular, objs[i].specular));
            } 
            /* 
            else {
                diffusePr = diffusePr.concat([0.0, 0.0, 0.0, 1.0]);
                specularPr = specularPr.concat([0.0, 0.0, 0.0, 1.0]);
            }
            */
            lightPos = lightPos.concat(lightPosVec);
        }
        gl.uniform4fv(ambientPrLoc, flatten(ambientPr));
        gl.uniform4fv(diffusePrLoc, flatten(diffusePr));
        gl.uniform4fv(specularPrLoc, flatten(specularPr));
        gl.uniform4fv(lightPosLoc, flatten(lightPos));
        gl.uniform1f(shininessLoc, objs[i].shininess);

        objs[i].transform(cam); 
        objs[i].mesh.draw();
    }

    requestAnimFrame(render);
}

