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

const NUM_VERTS = 50000;
const VERT_DATA_SIZE = 12;          // each vertex = (3 axes) * sizeof(float)
const NORMAL_DATA_SIZE = VERT_DATA_SIZE;
const TEXTURE_DATA_SIZE = 8;        // each vertex = (2 axes) * sizeof(float)

const NUM_ELEMS = 40000;  
const ELEM_DATA_SIZE = Uint16Array.BYTES_PER_ELEMENT;

var objs = [];
var meshes = [];
var objCount = 0;
var currObj = null;

var mvMatrixLoc;
var prMatrixLoc;
var ambientPrLoc, diffusePrLoc, specularPrLoc;
var lightPosLoc;
var shininessLoc;

var camEye;
var camAt;

var rotateMax = [360, 360, 360];

var rotateMin = negate(rotateMax);

var animate = true;

//-------------------------------------------------------------------------------------------------
function Light() 
{
    // light properties
    this.ambient  = vec4(0.2, 0.2, 0.2, 1.0);
    this.diffuse  = vec4(1.0, 1.0, 1.0, 1.0);
    this.specular = vec4(1.0, 1.0, 1.0, 1.0);
    this.pos = [1000.0, 0.0, 0.0];
    this.scale = [1, 1, 1];
    this.rotate = [0, 0, 0];        // rotate pos in world coordinates
}

Light.prototype.transform = function(camEye)
{
    var rx = rotateX(this.rotate[0]);
    var ry = rotateY(this.rotate[1]);
    var rz = rotateZ(this.rotate[2]);
    var r = mult(rz, mult(ry, rx));
    var w = mult(r, scalem(this.scale));
    // get light position relative to camera position
    var lpos = mult(translate(negate(camEye)), w);     
    return lpos;
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

    // lighting material properties
    this.ambient  = vec4(0.25, 0.25, 0.25, 1.0);
    this.diffuse  = vec4(1.0, 1.0, 1.0, 1.0);
    this.specular = vec4(0.2, 0.2, 0.2, 1.0);
    this.shininess = 15.0;

    // object in world space
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
    this.resolution = resolution || 64;
}
Sphere.prototype = Object.create(Mesh.prototype);

Sphere.prototype.addVertices = function() 
{
    function spherical_to_cartesian(theta, phi)
    {
        // phi is angle from xz-plane, need angle from y-axis
        var rho = Math.PI / 2 - phi;
        var x = Math.sin(rho) * Math.sin(theta);
        var y = Math.cos(rho);
        var z = Math.sin(rho) * Math.cos(theta);
        return [x, y, z];
    }
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
        this.addTexPos([0.5, 1]);
        this.addTexPos(getTexCoords(theta2, phi_south));
        this.addTexPos(getTexCoords(theta1, phi_south));
        addTriangle.call(this, north, n1, n2);
        this.addTexPos([0.5, 0]);
        this.addTexPos(getTexCoords(theta1, phi_north));
        this.addTexPos(getTexCoords(theta2, phi_north));
    }
 
    // send triangles to element buffer
    console.log(topo.length);
    this.addTopology(topo);
    this.elemCnt = topo.length;
}

Sphere.prototype.draw = function() 
{
    gl.drawElements(gl.TRIANGLES, this.elemCnt, gl.UNSIGNED_SHORT, this.elemIdx * ELEM_DATA_SIZE);
}

/*
Sphere.prototype.getTextCoords = function(vert) 
{
    // determine theta and phi from x, y, z
    var theta = Math.atan2(-vert[2], vert[0]);
    var phi   = Math.acos(vert[1]);
    // map to [0,1] texture square
    var s = (theta / (2.0 * Math.PI)) +  0.5;
    var t = (phi / Math.PI);
    return [s, t];
}
*/

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

    mvMatrixLoc = gl.getUniformLocation(program, 'mvMatrix');
    prMatrixLoc = gl.getUniformLocation(program, 'prMatrix');
    ambientPrLoc = gl.getUniformLocation(program, 'ambientProduct');
    diffusePrLoc = gl.getUniformLocation(program, 'diffuseProduct');
    specularPrLoc = gl.getUniformLocation(program, 'specularProduct');
    lightPosLoc = gl.getUniformLocation(program, 'lightPosition');
    shininessLoc = gl.getUniformLocation(program, 'shininess');
    
    // Create meshes
    meshes['sphere'] = new Sphere();
    for (var key in meshes) {
        if (meshes.hasOwnProperty(key)) {
            meshes[key].addVertices();
        }
    }
    
    document.getElementById("btn-reset").onclick = reset_scene;
   
    // inputs and slider controls
    document.getElementById('range-rotate-x').oninput = cur_obj_change;
    document.getElementById('range-rotate-y').oninput = cur_obj_change;
    document.getElementById('range-rotate-z').oninput = cur_obj_change;
    
    document.getElementById('radio-proj-perspective').checked = true;
    document.getElementById('range-cam-x').oninput = cam_change;
    document.getElementById('range-cam-y').oninput = cam_change;
    document.getElementById('range-cam-z').oninput = cam_change;
    document.getElementById('range-lookat-x').oninput = cam_change;
    document.getElementById('range-lookat-y').oninput = cam_change;
    document.getElementById('range-lookat-z').oninput = cam_change;
    
    reset_scene();
    
    // lights
    var light = new Light();
    light.ambient  = vec4(0.1, 0.1, 0.1, 1.0);
    light.diffuse  = vec4(1.0, 1.0, 1.0, 1.0);
    light.specular = vec4(1.0, 1.0, 1.0, 1.0);
    light.pos = vec4(-60e6, 0.0, 150e6, 1.0);
    lights.push(light);

    // default objects on canvas
    create_new_obj('sphere');
    currObj.scale = [6378, 6360, 6378];
    currObj.translate = [0, 0, 0];
    currObj.rotate = [0, 0, 15];
    // currObj.ambient  = vec4(0.3, 0.3, 0.3, 1.0);
    currObj.shininess = 50;
    cur_obj_set_controls();

    //var image = gen_checkboard();
    var image = new Image();
    image.onload = function() {
        configureTexture(image);
        gl.uniform1i(gl.getUniformLocation(program, 'texture'), 0);
    }
    image.src = "earth_8k.jpg";
    
    render();
}

//-------------------------------------------------------------------------------------------------
function create_new_obj(objType)
{
    var type = objType || document.getElementById('sel-type').value;
    var opt = document.createElement('option');
    objCount++;
    var name = type + objCount;
    opt.value = name;
    opt.innerHTML = name;

    objs.push(new CADObject(name, meshes[type]));
    currObj = objs[objs.length - 1];
    currObj.scale = [50, 50, 50];
    currObj.translate = camAt.slice();
    cur_obj_set_controls();
}

//-------------------------------------------------------------------------------------------------
function reset_scene()
{
    objs = [];
    currObj = null;
    objCount = 0;

    camEye = [0, 10000, 35000];
    camAt  = [0, 0, 0];
    cam_set();
}

//-------------------------------------------------------------------------------------------------
function clip_to_range(x, min, max)
{
    if (Array.isArray(x)) {
        for (var i = 0; i < x.length; ++i) {
            if (x[i] < min[i]) 
                x[i] = min[i];
            else if (x[i] > max[i])
                x[i] = max[i];
        }
    } else {
        if (x < min) x = min;
        else if (x > max) x = max;
    }

    return x;
}

//-------------------------------------------------------------------------------------------------
function cur_obj_set_controls()
{
    if (!currObj) {
        return;
    }
    
    clip_to_range(currObj.rotate, rotateMin, rotateMax);
    document.getElementById('range-rotate-x').value = document.getElementById('rotate-x').innerHTML = currObj.rotate[0];
    document.getElementById('range-rotate-y').value = document.getElementById('rotate-y').innerHTML = currObj.rotate[1];
    document.getElementById('range-rotate-z').value = document.getElementById('rotate-z').innerHTML = currObj.rotate[2];
}

//-------------------------------------------------------------------------------------------------
function cur_obj_change()
{
    if (currObj) {
        var rot_x = document.getElementById('range-rotate-x').value;
        var rot_y = document.getElementById('range-rotate-y').value;
        var rot_z = document.getElementById('range-rotate-z').value;
        currObj.rotate[0] = document.getElementById('rotate-x').innerHTML = +rot_x;
        currObj.rotate[1] = document.getElementById('rotate-y').innerHTML = +rot_y;
        currObj.rotate[2] = document.getElementById('rotate-z').innerHTML = +rot_z;
    }
}

//-------------------------------------------------------------------------------------------------
function cam_set()
{
    document.getElementById('range-cam-x').value = document.getElementById('cam-x').innerHTML = camEye[0];
    document.getElementById('range-cam-y').value = document.getElementById('cam-y').innerHTML = camEye[1];
    document.getElementById('range-cam-z').value = document.getElementById('cam-z').innerHTML = camEye[2];
    document.getElementById('range-lookat-x').value = document.getElementById('lookat-x').innerHTML = camAt[0];
    document.getElementById('range-lookat-y').value = document.getElementById('lookat-y').innerHTML = camAt[1];
    document.getElementById('range-lookat-z').value = document.getElementById('lookat-z').innerHTML = camAt[2];
}

//-------------------------------------------------------------------------------------------------
function cam_change()
{
    camEye[0] = document.getElementById('range-cam-x').value;
    camEye[1] = document.getElementById('range-cam-y').value;
    camEye[2] = document.getElementById('range-cam-z').value;
    document.getElementById('cam-x').innerHTML = camEye[0];
    document.getElementById('cam-y').innerHTML = camEye[1];
    document.getElementById('cam-z').innerHTML = camEye[2];

    camAt[0] = document.getElementById('range-lookat-x').value;
    camAt[1] = document.getElementById('range-lookat-y').value;
    camAt[2] = document.getElementById('range-lookat-z').value;
    document.getElementById('lookat-x').innerHTML = camAt[0];
    document.getElementById('lookat-y').innerHTML = camAt[1];
    document.getElementById('lookat-z').innerHTML = camAt[2];
}

//-------------------------------------------------------------------------------------------------
function gen_checkboard()
{
    var texSize = 512;
    var numChecks = 63;

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
function configureTexture(image) 
{
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    //gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    //gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0,  gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE0);

    //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

//-------------------------------------------------------------------------------------------------
function render()
{
    var cam = lookAt(camEye, camAt, [0, 1, 0]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    if (document.getElementById('radio-proj-perspective').checked) {
        var pr = perspective(22, 1, 1, 1000000);
    } else {
        var pr = ortho(-6500, 6500, -6500, 6500, 0, 1000000);
    }
    gl.uniformMatrix4fv(prMatrixLoc, gl.FALSE, flatten(pr));
    
    var cb_light = document.getElementById('cb-light');
    
    // light 
    //lights[0].rotate[0] += 0.1;
    //lights[0].rotate[1] += 1.0;
    //lights[0].rotate[2] += 0.1;
    objs[0].rotate[1] += 0.2;

    // iterate over all objects, do model-view transformation
    for (var i = 0; i < objs.length; ++i) {
        var ambientPr  = [];
        var diffusePr  = [];
        var specularPr = [];
        var lightPos   = [];
        for (var j = 0; j < lights.length; ++j) {
            var lmv = transpose(lights[j].transform(camEye));
            var lightPosVec = vec4(
                    dot(lmv[0], lights[j].pos),
                    dot(lmv[1], lights[j].pos),
                    dot(lmv[2], lights[j].pos),
                    dot(lmv[3], lights[j].pos));

            ambientPr = ambientPr.concat(mult(lights[j].ambient, objs[i].ambient));
            if (cb_light.checked) {
                diffusePr = diffusePr.concat(mult(lights[j].diffuse, objs[i].diffuse));
                specularPr = specularPr.concat(mult(lights[j].specular, objs[i].specular));
            } else {
                diffusePr = diffusePr.concat([0.0, 0.0, 0.0, 1.0]);
                specularPr = specularPr.concat([0.0, 0.0, 0.0, 1.0]);
            }
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

    // testing
    if (animate) {
        requestAnimFrame(render);
    }
}

