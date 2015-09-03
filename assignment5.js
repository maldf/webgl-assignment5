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
function Sphere(recurse) {
    Mesh.call(this);
    this.recurse = recurse || 3;
}
Sphere.prototype = Object.create(Mesh.prototype);

Sphere.prototype.addMeshPoint = function(p) 
{
    // add points normalized to unit circle length
    normalize(p);
    // only add new points; if point already exists, return its index
    for (var i = 0; i < this.vert.length; ++i) {
        if (equal(this.vert[i], p)) {
            return i;
        }
    }
    this.vert.push(p);
    // return vertex index
    return this.vert.length - 1;
}

Sphere.prototype.addVertices = function() 
{
    // create sphere from icosahedron, ref:
    // http://blog.andreaskahler.com/2009/06/creating-icosphere-mesh-in-code.html
    
    // create 12 vertices of a icosahedron
    var t = (1.0 + Math.sqrt(5.0)) / 2.0;
    this.vert = [];
    this.addMeshPoint([-1,  t,  0]);
    this.addMeshPoint([ 1,  t,  0]);
    this.addMeshPoint([-1, -t,  0]);
    this.addMeshPoint([ 1, -t,  0]);

    this.addMeshPoint([ 0, -1,  t]);
    this.addMeshPoint([ 0,  1,  t]);
    this.addMeshPoint([ 0, -1, -t]);
    this.addMeshPoint([ 0,  1, -t]);

    this.addMeshPoint([ t,  0, -1]);
    this.addMeshPoint([ t,  0,  1]);
    this.addMeshPoint([-t,  0, -1]);
    this.addMeshPoint([-t,  0,  1]);
   
    var faces = [];
    // 5 faces around point 0
    faces.push([0, 11, 5]);
    faces.push([0, 5, 1]);
    faces.push([0, 1, 7]);
    faces.push([0, 7, 10]);
    faces.push([0, 10, 11]);

    // 5 adjacent faces
    faces.push([1, 5, 9]);
    faces.push([5, 11, 4]);
    faces.push([11, 10, 2]);
    faces.push([10, 7, 6]);
    faces.push([7, 1, 8]);

    // 5 faces around point 3
    faces.push([3, 9, 4]);
    faces.push([3, 4, 2]);
    faces.push([3, 2, 6]);
    faces.push([3, 6, 8]);
    faces.push([3, 8, 9]);

    // 5 adjacent faces
    faces.push([4, 9, 5]);
    faces.push([2, 4, 11]);
    faces.push([6, 2, 10]);
    faces.push([8, 6, 7]);
    faces.push([9, 8, 1]);

    // refine triangles
    for (var i = 0; i < this.recurse; ++i) {
        var faces2 = [];
        for (var j = 0; j < faces.length; ++j) {
            var tri = faces[j];
            // replace triangle by 4 triangles
            var a = this.addMeshPoint(mix(this.vert[tri[0]], this.vert[tri[1]], 0.5));
            var b = this.addMeshPoint(mix(this.vert[tri[1]], this.vert[tri[2]], 0.5));
            var c = this.addMeshPoint(mix(this.vert[tri[2]], this.vert[tri[0]], 0.5));

            faces2.push([tri[0], a, c]);
            faces2.push([tri[1], b, a]);
            faces2.push([tri[2], c, b]);
            faces2.push([a, b, c]);
        }
        faces = faces2;
    }
    
    // send final vertices to GPU buffer
    for (var i = 0; i < this.vert.length; ++i) {
        this.addPoint(this.vert[i]);
        this.addNormal(this.vert[i]);

        this.addTexPos(this.getTexCoords(this.vert[i]));
    }
 
    // send triangles to element buffer
    var topo = [];
    for (var i = 0; i < faces.length; ++i) {
        topo = topo.concat(faces[i]);
    }
    this.addTopology(topo);
    this.elemCnt = faces.length * 3;
}

Sphere.prototype.draw = function() 
{
    gl.drawElements(gl.TRIANGLES, this.elemCnt, gl.UNSIGNED_SHORT, this.elemIdx * ELEM_DATA_SIZE);
}

Sphere.prototype.getTexCoords = function(vert)
{
    // determine theta and phi from x, y, z
    var theta = Math.acos(vert[0]);
    var phi = Math.acos(vert[1] / Math.sin(theta));
    var coords = [theta / (2.0 * Math.PI) + 0.5, phi / (2.0 * Math.PI) + 0.5];
    return coords;
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

    mvMatrixLoc = gl.getUniformLocation(program, 'mvMatrix');
    prMatrixLoc = gl.getUniformLocation(program, 'prMatrix');
    ambientPrLoc = gl.getUniformLocation(program, 'ambientProduct');
    diffusePrLoc = gl.getUniformLocation(program, 'diffuseProduct');
    specularPrLoc = gl.getUniformLocation(program, 'specularProduct');
    lightPosLoc = gl.getUniformLocation(program, 'lightPosition');
    shininessLoc = gl.getUniformLocation(program, 'shininess');
    
    // Create meshes
    meshes['sphere'] = new Sphere(4);
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
    light.pos = vec4(-2000.0, 0.0, 1500.0, 1.0);
    lights.push(light);

    // default objects on canvas
    create_new_obj('sphere');
    currObj.scale = [200, 200, 200];
    currObj.translate = [0, 0, 0];
    currObj.rotate = [0, 0, 15];
    // currObj.ambient  = vec4(0.3, 0.3, 0.3, 1.0);
    currObj.shininess = 10;
    cur_obj_set_controls();

    //var image = gen_checkboard();
    var image = new Image();
    image.onload = function() {
        configureTexture(image);
        gl.uniform1i(gl.getUniformLocation(program, 'texture'), 0);
    }
    image.src = "earthmap1k.jpg";
    
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

    camEye = [0, 0, 300];
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
    //gl.generateMipmap(gl.TEXTURE_2D);
    //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

//-------------------------------------------------------------------------------------------------
function render()
{
    var cam = lookAt(camEye, camAt, [0, 1, 0]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    if (document.getElementById('radio-proj-perspective').checked) {
        var pr = perspective(90, 2, 1, 10000);
    } else {
        var pr = ortho(-2000, 2000, -1000, 1000, -2000, 2000);
    }
    gl.uniformMatrix4fv(prMatrixLoc, gl.FALSE, flatten(pr));
    
    var cb_light = document.getElementById('cb-light');
    
    // light 
    //lights[0].rotate[0] += 0.1;
    //lights[0].rotate[1] += 1.0;
    //lights[0].rotate[2] += 0.1;
    objs[0].rotate[1] += 0.2

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
        //requestAnimFrame(render);
    }
}

