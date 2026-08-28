import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import { spawn } from 'node:child_process';

function executeCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  onOutput: (message: string) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: globalThis.process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    childProcess.stdout.on('data', (data: Buffer) => {
      const message = data.toString().trimEnd();

      if (message) {
        options.onOutput(message);
      }
    });

    childProcess.stderr.on('data', (data: Buffer) => {
      const message = data.toString().trimEnd();

      if (message) {
        options.onOutput(message);
      }
    });

    childProcess.on('error', (error: Error) => {
      reject(
        new Error(
          `No fue posible ejecutar ${options.command}: ${error.message}`,
        ),
      );
    });

    childProcess.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${options.command} terminó con código de salida ${String(code)}`,
        ),
      );
    });
  });
}

function createCopierAction() {
  return createTemplateAction({
    id: 'uno:copier:copy',

    description:
      'Genera un proyecto en el workspace de Scaffolder utilizando Copier',

    schema: {
      input: {
        templateUrl: z =>
          z.string({
            description:
              'Origen del template Copier, por ejemplo gh:unoafp/uno-tool-template-microservicio-py',
          }),

        vcsRef: z =>
          z
            .string({
              description: 'Rama, tag o commit del template',
            })
            .optional(),

        skipTasks: z =>
          z
            .boolean({
              description:
                'Omite las tareas post-generación definidas por Copier',
            })
            .default(true),

        values: z =>
          z.record(
            z.union([z.string(), z.number(), z.boolean()]),
            {
              description: 'Respuestas que se entregarán a Copier',
            },
          ),
      },

      output: {
        outputPath: z =>
          z.string({
            description: 'Ruta del workspace generado',
          }),
      },
    },

    async handler(ctx) {
      const args: string[] = [
        'copier',
        'copy',
        ctx.input.templateUrl,
        ctx.workspacePath,
        '--trust',
        '--defaults',
        '--overwrite',
      ];

      if (ctx.input.vcsRef) {
        args.push('--vcs-ref', ctx.input.vcsRef);
      }

      if (ctx.input.skipTasks !== false) {
        args.push('--skip-tasks');
      }

      for (const [key, value] of Object.entries(ctx.input.values)) {
        args.push('--data', `${key}=${String(value)}`);
      }

      ctx.logger.info(
        `Ejecutando Copier desde ${ctx.input.templateUrl}`,
      );

      ctx.logger.info(
        `Variables recibidas: ${Object.keys(ctx.input.values).join(', ')}`,
      );

      await executeCommand({
        command: 'uvx',
        args,
        cwd: ctx.workspacePath,
        onOutput: message => ctx.logger.info(message),
      });

      ctx.output('outputPath', ctx.workspacePath);

      ctx.logger.info('Copier terminó correctamente');
    },
  });
}

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'uno-copier',

  register(registrar) {
    registrar.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
      },

      async init({ scaffolderActions }) {
        scaffolderActions.addActions(createCopierAction());
      },
    });
  },
});
