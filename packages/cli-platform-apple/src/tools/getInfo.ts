import type {IOSProjectInfo} from '@react-native-community/cli-types';
import execa from 'execa';
import {XMLParser} from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';
import type {IosInfo} from '../types';

function isErrorLike(err: unknown): err is {message: string} {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'message' in err &&
      typeof err.message === 'string',
  );
}

function parseTargetList(json: string): IosInfo | undefined {
  try {
    const info = JSON.parse(json);

    if ('project' in info) {
      return info.project;
    } else if ('workspace' in info) {
      return info.workspace;
    }

    return undefined;
  } catch (error) {
    if (isErrorLike(error)) {
      const match = error.message.match(/xcodebuild: error: (.*)/);
      if (match) {
        throw new Error(match[0]);
      }
    }

    throw error;
  }
}

export function getInfo(
  projectInfo: IOSProjectInfo,
  sourceDir: string,
): IosInfo | undefined {
  if (!projectInfo.isWorkspace) {
    const xcodebuild = execa.sync('xcodebuild', ['-list', '-json']);
    return parseTargetList(xcodebuild.stdout);
  }

  const xmlParser = new XMLParser({ignoreAttributes: false});
  const xcworkspacedata = path.join(
    sourceDir,
    projectInfo.name,
    'contents.xcworkspacedata',
  );
  const workspace = fs.readFileSync(xcworkspacedata, {encoding: 'utf-8'});
  const fileRef = xmlParser.parse(workspace).Workspace.FileRef;
  const refs = Array.isArray(fileRef) ? fileRef : [fileRef];

  return refs.reduce<IosInfo | undefined>((result, ref) => {
    const location = ref['@_location'];

    if (!location.endsWith('.xcodeproj')) {
      return result;
    }

    // Ignore the project generated by CocoaPods
    if (location.endsWith('/Pods.xcodeproj')) {
      return result;
    }

    const xcodebuild = execa.sync('xcodebuild', [
      '-list',
      '-json',
      '-project',
      path.join(
        sourceDir,
        location.replace('group:', '').replace('container:', ''),
      ),
    ]);
    const info = parseTargetList(xcodebuild.stdout);
    if (!info) {
      return result;
    }

    const schemes = info.schemes;

    // If this is the first project, use it as the "main" project
    if (!result) {
      if (!Array.isArray(schemes)) {
        info.schemes = [];
      }
      return info;
    }

    if (!Array.isArray(result.schemes)) {
      throw new Error("This shouldn't happen since we set it earlier");
    }

    // For subsequent projects, merge schemes list
    if (Array.isArray(schemes) && schemes.length > 0) {
      result.schemes = result.schemes.concat(schemes);
    }

    return result;
  }, undefined);
}
