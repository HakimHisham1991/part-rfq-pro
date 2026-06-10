using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/operation-templates")]
public class OperationTemplatesController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<OperationTemplateDto>>> List()
    {
        var items = await db.OperationTemplates.OrderBy(t => t.OperationType).ThenBy(t => t.Name).ToListAsync();
        return items.Select(t => t.ToDto()).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<OperationTemplateDto>> Create([FromBody] CreateOperationTemplateRequest request)
    {
        var name = (request.Name ?? "").Trim();
        var operationType = (request.OperationType ?? "").Trim();
        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(name))
            return BadRequest("Template name is required.");
        if (string.IsNullOrEmpty(operationType))
            return BadRequest("Operation type is required.");
        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        if (await db.OperationTemplates.AnyAsync(t => t.Name == name))
            return BadRequest("Operation template name already exists.");

        var template = new OperationTemplate
        {
            Name = name,
            OperationType = operationType,
            ParamsJson = SerializeParams(request.Params),
            CreatedBy = createdBy,
            CreatedDate = createdDate,
            Status = status
        };

        db.OperationTemplates.Add(template);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, template.ToDto());
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<OperationTemplateDto>> Update(int id, [FromBody] UpdateOperationTemplateRequest request)
    {
        var template = await db.OperationTemplates.FindAsync(id);
        if (template == null) return NotFound();

        var name = (request.Name ?? "").Trim();
        var operationType = (request.OperationType ?? "").Trim();
        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(name))
            return BadRequest("Template name is required.");
        if (string.IsNullOrEmpty(operationType))
            return BadRequest("Operation type is required.");
        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        if (await db.OperationTemplates.AnyAsync(t => t.Name == name && t.Id != id))
            return BadRequest("Operation template name already exists.");

        template.Name = name;
        template.OperationType = operationType;
        template.ParamsJson = SerializeParams(request.Params);
        template.CreatedBy = createdBy;
        template.CreatedDate = createdDate;
        template.Status = status;

        await db.SaveChangesAsync();
        return template.ToDto();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var template = await db.OperationTemplates.FindAsync(id);
        if (template == null) return NotFound();

        db.OperationTemplates.Remove(template);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string SerializeParams(JsonElement? paramsEl)
    {
        if (paramsEl is not { ValueKind: JsonValueKind.Object })
            return "{}";
        return paramsEl.Value.GetRawText();
    }

    private static string NormalizeStatus(string? status)
    {
        var s = (status ?? "").Trim();
        if (s.Equals("inactive", StringComparison.OrdinalIgnoreCase))
            return "Inactive";
        return "Active";
    }
}
